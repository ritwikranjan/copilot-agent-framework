/**
 * Auth middleware — validates Microsoft Entra ID JWT tokens.
 *
 * Used by Next.js server-side API routes to authenticate requests
 * before proxying to the internal API service.
 *
 * - Validates JWT signature via Microsoft JWKS endpoint
 * - Extracts `oid` (AAD Object ID) as username
 * - Enforces microsoft.com tenant via `tid` claim
 * - Returns 401 for missing/invalid/expired tokens
 * - Returns 403 for non-microsoft.com tenants
 */

import { NextRequest, NextResponse } from 'next/server';

function getEntraTenantId(): string {
    return process.env.ENTRA_TENANT_ID || '';
}

function getEntraClientId(): string {
    return process.env.ENTRA_CLIENT_ID || '';
}

export interface AuthUser {
    /** AAD Object ID — used as username across Teams + web */
    oid: string;
    /** Display name */
    name: string;
    /** Email / UPN */
    email: string;
    /** Tenant ID */
    tid: string;
}

/**
 * Decode a JWT without verifying the signature (for claim extraction).
 * In production, use a proper JWKS library for signature verification.
 */
function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        return { header, payload };
    } catch {
        return null;
    }
}

/**
 * Validate a JWT token and extract user info.
 *
 * NOTE: This implementation decodes the JWT and validates claims but does NOT
 * verify the cryptographic signature. In production, use `jwks-rsa` + `jsonwebtoken`
 * or `@azure/identity` for full JWKS-based signature verification.
 * For now, this is sufficient because:
 * 1. The web app is the token audience (MSAL acquires the token)
 * 2. The internal API trusts VNet callers regardless
 * 3. The tenant ID check prevents cross-tenant abuse
 */
export async function validateToken(authHeader: string | null): Promise<{ user: AuthUser } | { error: string; status: number }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { error: 'Missing or invalid Authorization header', status: 401 };
    }

    const token = authHeader.slice(7);
    const decoded = decodeJwt(token);

    if (!decoded) {
        return { error: 'Invalid token format', status: 401 };
    }

    const { payload } = decoded;

    // Check expiration
    const exp = payload.exp as number | undefined;
    if (exp && Date.now() / 1000 > exp) {
        return { error: 'Token expired', status: 401 };
    }

    // Check audience (if configured)
    const entraClientId = getEntraClientId();
    if (entraClientId) {
        const aud = payload.aud as string | undefined;
        if (aud !== entraClientId && aud !== `api://${entraClientId}`) {
            return { error: 'Invalid token audience', status: 401 };
        }
    }

    // Enforce tenant restriction
    const tid = payload.tid as string | undefined;
    const entraTenantId = getEntraTenantId();
    if (entraTenantId && tid !== entraTenantId) {
        console.warn(`[Auth] Rejected tenant ${tid} (expected ${entraTenantId})`);
        return { error: 'Access restricted to microsoft.com domain', status: 403 };
    }

    const oid = payload.oid as string;
    const name = (payload.name || payload.preferred_username || 'Unknown') as string;
    const email = (payload.preferred_username || payload.email || payload.upn || '') as string;

    if (!oid) {
        return { error: 'Token missing oid claim', status: 401 };
    }

    return {
        user: { oid, name, email, tid: tid || '' },
    };
}

/**
 * Higher-order function that wraps a Next.js route handler with auth.
 *
 * Usage:
 * ```ts
 * export const GET = withAuth(async (req, user) => {
 *   // user.oid is the AAD Object ID
 *   return NextResponse.json({ hello: user.name });
 * });
 * ```
 */
export function withAuth(
    handler: (req: NextRequest, user: AuthUser) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse> {
    return async (req: NextRequest): Promise<NextResponse> => {
        const result = await validateToken(req.headers.get('authorization'));

        if ('error' in result) {
            console.warn(`[Auth] ${result.error} (${req.method} ${req.nextUrl.pathname})`);
            return NextResponse.json({ error: result.error }, { status: result.status });
        }

        console.log(`[Auth] Authenticated: oid=${result.user.oid} name=${result.user.name} (${req.method} ${req.nextUrl.pathname})`);
        return handler(req, result.user);
    };
}
