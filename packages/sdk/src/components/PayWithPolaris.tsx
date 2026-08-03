
import React, { useState } from 'react';
import { ethers } from 'ethers';
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react';

const POLARIS_API_URL = 'http://localhost:3000/api/bills/create';

interface PayWithPolarisProps {
    apiKey: string;
    apiSecret: string;
    amount: number;
    details: string;
    onSuccess?: (txHash: string) => void;
    onError?: (error: string) => void;
    className?: string; // Allow custom styling
}

export const PayWithPolaris: React.FC<PayWithPolarisProps> = ({
    apiKey,
    apiSecret,
    amount,
    details,
    onSuccess,
    onError,
    className
}) => {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [error, setError] = useState<string>('');

    const handlePayment = async () => {
        setLoading(true);
        setStatus('Initializing...');
        setError('');

        try {
            // 1. Fetch Payment Config
            const res = await fetch(POLARIS_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-client-id': apiKey,
                    'x-client-secret': apiSecret
                },
                body: JSON.stringify({ amount, description: details })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to initialize payment');
            }

            const config = await res.json();
            const { escrowAddress, orderId, chainId } = config;

            if (!window.ethereum) throw new Error('No crypto wallet found. Please install Metamask.');

            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();

            // Check Network
            const network = await provider.getNetwork();
            if (network.chainId !== BigInt(chainId)) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: '0x' + chainId.toString(16) }],
                    });
                } catch (switchError: any) {
                    // This error code indicates that the chain has not been added to MetaMask.
                    if (switchError.code === 4902) {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [
                                {
                                    chainId: '0x' + chainId.toString(16),
                                    chainName: 'Creditcoin Testnet',
                                    rpcUrls: ['https://rpc.cc3-testnet.creditcoin.network'], // check RPC
                                    nativeCurrency: {
                                        name: 'Creditcoin',
                                        symbol: 'tCTC', // Testnet CTC
                                        decimals: 18
                                    }
                                },
                            ],
                        });
                    } else {
                        throw switchError;
                    }
                }
                // Update signer after switch? usually provider handles it but good to be safe
            }

            // 2. Interact with Contract
            setStatus('Please confirm transaction...');

            // ABI for settlePayment
            const abi = [
                "function settlePayment(uint256 amount, string orderId, string details) external",
                "function approve(address spender, uint256 amount) external returns (bool)"
            ];

            // Setup Token Approval First (Assuming USDC is used)
            // But wait, the contract logic in settlePayment uses `transferFrom(msg.sender, address(this), amount)`.
            // So we need to APPROVE the Escrow Contract to spend User's USDC first.
            // Which USDC? 
            // The JSON returned `currency: 'USDC'`, but we need the token address.
            // `config` didn't return token address. 
            // The contract usually knows the token.
            // BUT the user needs to approve the token.
            // I should fetch the token address from the contract or config.

            // Re-read contract: `stablecoin()` returns address.
            const escrowContract = new ethers.Contract(escrowAddress, [
                ...abi,
                "function stablecoin() view returns (address)"
            ], signer);

            const tokenAddress = await escrowContract.stablecoin();
            const tokenContract = new ethers.Contract(tokenAddress, [
                "function approve(address spender, uint256 amount) external returns (bool)",
                "function allowance(address owner, address spender) view returns (uint256)"
            ], signer);

            const amountWei = ethers.parseUnits(amount.toString(), 18); // Assuming 18 decimals

            // Check Allowance
            setStatus('Checking allowance...');
            const allowance = await tokenContract.allowance(await signer.getAddress(), escrowAddress);
            if (allowance < amountWei) {
                setStatus('Approving access to funds...');
                const approveTx = await tokenContract.approve(escrowAddress, amountWei);
                await approveTx.wait();
            }

            setStatus('Processing Payment...');
            const tx = await escrowContract.settlePayment(amountWei, orderId, details);

            setStatus('Waiting for confirmation...');
            await tx.wait();

            setStatus('Success!');
            if (onSuccess) onSuccess(tx.hash);

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Payment failed');
            if (onError) onError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`flex flex-col items-center gap-4 ${className}`}>
            {error && (
                <div className="text-red-500 text-sm flex items-center gap-2 bg-red-500/10 p-2 rounded">
                    <AlertCircle className="w-4 h-4" /> {error}
                </div>
            )}

            <button
                onClick={handlePayment}
                disabled={loading}
                className={`
                    flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black font-bold py-3 px-6 rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                    ${loading ? 'cursor-wait' : ''}
                `}
            >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                {loading ? status : `Pay ${amount} USDC with Polaris`}
            </button>

            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                Secured by Polaris Protocol
            </div>
        </div>
    );
};
