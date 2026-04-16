'use client';

import { useEffect, useState } from 'react';
import { getMsalInstance, loginRequest } from '@/lib/msal';
import type { AccountInfo } from '@azure/msal-browser';

/**
 * Auth-gated home page — redirects to /chat after login.
 * Shows login button if not authenticated.
 */
export default function HomePage() {
    const [account, setAccount] = useState<AccountInfo | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function init() {
            try {
                const msalInstance = getMsalInstance();
                await msalInstance.initialize();
                const response = await msalInstance.handleRedirectPromise();
                if (response?.account) {
                    setAccount(response.account);
                } else {
                    const accounts = msalInstance.getAllAccounts();
                    if (accounts.length > 0) {
                        setAccount(accounts[0]);
                    }
                }
            } catch (err) {
                console.error('MSAL init error:', err);
            } finally {
                setLoading(false);
            }
        }
        init();
    }, []);

    useEffect(() => {
        if (account) {
            window.location.href = '/chat';
        }
    }, [account]);

    const handleLogin = async () => {
        try {
            const msalInstance = getMsalInstance();
            const response = await msalInstance.loginPopup(loginRequest);
            if (response?.account) {
                setAccount(response.account);
            }
        } catch (err) {
            console.error('Login failed:', err);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-gray-500">Loading...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-6">
            <h1 className="text-3xl font-bold">Copilot Chat</h1>
            <p className="text-gray-500 max-w-md text-center">
                Cross-platform AI chat powered by GitHub Copilot.
                Your conversations sync between Teams and this web app.
            </p>
            <button
                onClick={handleLogin}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-lg"
            >
                Sign in with Microsoft
            </button>
            <p className="text-xs text-gray-400">Restricted to microsoft.com accounts</p>
        </div>
    );
}
