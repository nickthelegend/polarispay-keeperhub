import { useEffect } from 'react';

import { useWallet } from '@/components/WalletProvider';

/**
 * Record the connected wallet so the merchant console can attribute activity to
 * it. There is no email here any more: sign-in is the wallet, so an address is
 * the whole identity.
 */
export function useUserSync() {
    const { address } = useWallet();

    useEffect(() => {
        if (!address) return;
        fetch('/api/auth/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet_address: address }),
        }).catch((err) => console.error('Failed to sync user', err));
    }, [address]);
}
