/**
 * MSAL Configuration — Microsoft Entra ID authentication for the web app.
 *
 * Single-tenant configuration restricted to microsoft.com.
 * Uses MSAL Browser for SPA authentication with Authorization Code Flow + PKCE.
 */

import { PublicClientApplication, type Configuration, LogLevel } from '@azure/msal-browser';

const ENTRA_CLIENT_ID = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID || '';
const ENTRA_TENANT_ID = process.env.NEXT_PUBLIC_ENTRA_TENANT_ID || '';
const REDIRECT_URI = process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3001';

export const msalConfig: Configuration = {
    auth: {
        clientId: ENTRA_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
        redirectUri: REDIRECT_URI,
        postLogoutRedirectUri: REDIRECT_URI,
    },
    cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
    },
    system: {
        loggerOptions: {
            loggerCallback: (level, message, containsPii) => {
                if (containsPii) return;
                switch (level) {
                    case LogLevel.Error:
                        console.error('[MSAL]', message);
                        break;
                    case LogLevel.Warning:
                        console.warn('[MSAL]', message);
                        break;
                    case LogLevel.Info:
                        console.info('[MSAL]', message);
                        break;
                    case LogLevel.Verbose:
                        console.debug('[MSAL]', message);
                        break;
                }
            },
            logLevel: LogLevel.Warning,
        },
    },
};

export const loginRequest = {
    scopes: [`api://${ENTRA_CLIENT_ID}/Chat.ReadWrite`],
};

let msalInstance: PublicClientApplication | null = null;

export function getMsalInstance(): PublicClientApplication {
    if (!msalInstance) {
        msalInstance = new PublicClientApplication(msalConfig);
    }
    return msalInstance;
}
