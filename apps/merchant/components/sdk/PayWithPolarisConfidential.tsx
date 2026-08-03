"use client";

import React, { useState } from "react";
import { ethers } from "ethers";
import { Loader2, ShieldCheck, AlertCircle, Lock } from "lucide-react";
import { getCoFHEClient, encryptUint64 } from "@/lib/cofhe";
import { txPending, txSubmitted, txError } from "@/lib/tx-toast";
import ConfidentialTokenABI from "@/lib/abis/ConfidentialToken.json";
import ConfidentialMerchantEscrowABI from "@/lib/abis/ConfidentialMerchantEscrow.json";

/**
 * Confidential checkout: pays a merchant with an ENCRYPTED amount via
 * ConfidentialMerchantEscrow. The on-chain transaction reveals only that an order was
 * paid — never the amount. Replaces the transparent ERC20 `settlePayment` path.
 */
interface Props {
  amount: number; // human units (6-decimal confidential token)
  orderId: string; // unique order reference
  merchant: string; // merchant payout address
  escrowAddress?: string;
  tokenAddress?: string;
  chainId?: number;
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

const ESCROW = (a?: string) => a || process.env.NEXT_PUBLIC_CONF_MERCHANT_ESCROW || "";
const TOKEN = (a?: string) => a || process.env.NEXT_PUBLIC_CONF_USDC || "";

export const PayWithPolarisConfidential: React.FC<Props> = ({
  amount,
  orderId,
  merchant,
  escrowAddress,
  tokenAddress,
  chainId = 11155111,
  onSuccess,
  onError,
  className,
}) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const handlePayment = async () => {
    setLoading(true);
    setError("");
    setStatus("Connecting wallet...");
    try {
      const escrow = ESCROW(escrowAddress);
      const token = TOKEN(tokenAddress);
      if (!escrow || !token) throw new Error("Confidential escrow/token not configured");
      if (!ethers.isAddress(merchant)) throw new Error("Invalid merchant address");
      if (!(window as any).ethereum) throw new Error("No crypto wallet found. Please install MetaMask.");

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(chainId)) {
        await (window as any).ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + chainId.toString(16) }],
        });
      }
      const signer = await provider.getSigner();

      // 1. Encrypt the amount (6 decimals) off-chain.
      setStatus("Encrypting amount...");
      const client = await getCoFHEClient(signer);
      const amountUnits = BigInt(Math.round(amount * 1e6));
      const enc = await encryptUint64(client, amountUnits);

      // 2. Grant the escrow a short operator window so it can pull the confidential tokens.
      setStatus("Authorizing payment...");
      const tokenContract = new ethers.Contract(token, ConfidentialTokenABI as any, signer);
      const until = Math.floor(Date.now() / 1000) + 600; // 10 min
      await (await tokenContract.setOperator(escrow, until)).wait();

      // 3. Settle privately.
      setStatus("Processing private payment...");
      const escrowContract = new ethers.Contract(escrow, ConfidentialMerchantEscrowABI as any, signer);
      const orderHash = ethers.id(orderId);
      const toastId = txPending("Encrypting & settling privately…");
      const tx = await escrowContract.settlePayment(orderHash, merchant, enc);
      setStatus("Waiting for confirmation...");
      await tx.wait();

      txSubmitted(tx.hash, "Confidential payment settled", toastId);
      setStatus("Success!");
      onSuccess?.(tx.hash);
    } catch (err: any) {
      const msg = err?.reason || err?.message || "Payment failed";
      setError(msg.includes("Unknown merchant") ? "Merchant not registered for confidential payments." : msg);
      txError(err);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`flex flex-col items-center gap-4 ${className || ""}`}>
      {error && (
        <div className="text-red-500 text-sm flex items-center gap-2 bg-red-500/10 p-2 rounded">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      <button
        onClick={handlePayment}
        disabled={loading}
        className="flex items-center gap-2 bg-primary text-black font-black uppercase tracking-tighter py-4 px-8 rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_8px_30px_rgba(166,242,74,0.3)]"
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
        {loading ? status : `Pay ${amount} cUSDC privately`}
      </button>
      <div className="text-[10px] text-white/30 uppercase tracking-[0.3em] font-bold flex items-center gap-2">
        <ShieldCheck className="w-3 h-3 text-primary" />
        Amount encrypted end-to-end · Fhenix CoFHE
      </div>
    </div>
  );
};
