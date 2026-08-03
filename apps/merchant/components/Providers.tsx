'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { ReactNode } from 'react';
import { sepolia } from 'viem/chains';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

// Privy app IDs are 24-25 character cuids. Anything shorter is a placeholder
// or a truncated paste, and PrivyProvider throws on it at construction.
const isConfigured = PRIVY_APP_ID.length >= 20;

export default function Providers({ children }: { children: ReactNode }) {
    // Providers sits in the root layout, so a PrivyProvider that throws takes
    // down every route in the app -- including ones that never touch auth, like
    // /demo and the API-backed read views. An unconfigured optional integration
    // should degrade to "you cannot sign in", not "nothing renders".
    if (!isConfigured) {
        if (typeof window !== 'undefined') {
            console.warn(
                '[Providers] NEXT_PUBLIC_PRIVY_APP_ID is missing or malformed. Wallet sign-in is disabled; read-only routes still work.'
            );
        }
        return <>{children}</>;
    }

    return (
        <PrivyProvider
            appId={PRIVY_APP_ID}
            config={{
                loginMethods: ['email', 'wallet'],
                appearance: {
                    theme: 'dark',
                    accentColor: '#A6F24A', // neon-lime
                    showWalletLoginFirst: true,
                },
                defaultChain: sepolia,
                supportedChains: [sepolia],
                embeddedWallets: {
                    ethereum: {
                        createOnLogin: 'users-without-wallets',
                    },
                },
            }}
        >
            {children}
        </PrivyProvider>
    );
}
