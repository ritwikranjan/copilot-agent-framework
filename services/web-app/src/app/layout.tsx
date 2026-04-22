import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Copilot Chat',
    description: 'Cross-platform AI chat powered by GitHub Copilot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen">
                {children}
            </body>
        </html>
    );
}
