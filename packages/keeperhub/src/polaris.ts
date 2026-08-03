/**
 * Polaris protocol bindings.
 *
 * The minimal ABI surface the keeper needs, plus the three operations that
 * make up PolarisPay's on-chain lifecycle. Each maps a business event onto the
 * KeeperHub primitive that fits it:
 *
 *   installment due   -> simulate, then contract-call `repay`
 *   loan unhealthy    -> check-and-execute `checkLiquidatable` -> `liquidate`
 *   merchant payable  -> contract-call `settlePayment` (or a Tempo batch)
 *
 * Signatures are taken from packages/protocol/contracts/LoanEngine.sol and
 * apps/merchant/contracts/PolarisMerchantEscrow.sol.
 */

import { chargeKey, encodeArgs, type KeeperHubClient } from "./client.js";
import { isKeeperHubError, KeeperHubError } from "./errors.js";
import {
  type Receipt,
  receiptFromStatus,
  type ReceiptStore,
} from "./receipts.js";
import type { ChainId } from "./types.js";

/** `LoanEngine` -- only what the keeper calls. */
export const LOAN_ENGINE_ABI = JSON.stringify([
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "checkLiquidatable",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "userActiveDebt",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "loans",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple" }],
  },
]);

/** `PolarisMerchantEscrow.settlePayment(uint256,string,string)`. */
export const MERCHANT_ESCROW_ABI = JSON.stringify([
  {
    type: "function",
    name: "settlePayment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "orderId", type: "string" },
      { name: "details", type: "string" },
    ],
    outputs: [],
  },
]);

export type PolarisDeployment = {
  chainId: ChainId | number;
  loanEngine: string;
  scoreManager?: string;
  poolManager?: string;
};

export type CollectInstallmentParams = {
  loanId: string;
  /** 1-based installment index, for the receipt and the idempotency key. */
  installment: number;
  /** Base-unit amount (already scaled by the token's decimals). */
  amountRaw: string;
  /** Human-readable amount, for receipts only. */
  amountDisplay?: string;
  attempt?: number;
};

export type LiquidateParams = {
  loanId: string;
  attempt?: number;
};

export type SettleMerchantParams = {
  merchantId: string;
  escrowAddress: string;
  amountRaw: string;
  orderId: string;
  details?: string;
  amountDisplay?: string;
  attempt?: number;
};

export class PolarisKeeper {
  constructor(
    private readonly kh: KeeperHubClient,
    private readonly deployment: PolarisDeployment,
    private readonly receipts: ReceiptStore
  ) {}

  /**
   * Collect one installment.
   *
   * Simulate first. An installment that would revert -- almost always because
   * the borrower's balance moved -- becomes a dunning event rather than a
   * burnt transaction, and the reason is recorded on the receipt so the retry
   * ladder knows whether waiting will help.
   */
  async collectInstallment(params: CollectInstallmentParams): Promise<Receipt> {
    const attempt = params.attempt ?? 1;
    const actionId = `loan-${params.loanId}-inst-${params.installment}`;
    const call = {
      contractAddress: this.deployment.loanEngine,
      chainId: this.deployment.chainId,
      functionName: "repay",
      functionArgs: encodeArgs([params.loanId, params.amountRaw]),
      abi: LOAN_ENGINE_ABI,
    };

    const base = {
      actionId,
      kind: "installment_charge" as const,
      loanId: params.loanId,
      installment: params.installment,
      amount: params.amountDisplay ?? params.amountRaw,
      chainId: Number(this.deployment.chainId),
      attempt,
    };

    try {
      const sim = await this.kh.assertWouldSucceed(call);
      const status = await this.kh.executeAndConfirm(call, {
        idempotencyKey: chargeKey(actionId, attempt),
      });
      const receipt = receiptFromStatus(
        {
          ...base,
          simulation: { ok: true, gasEstimate: sim?.gasEstimate },
        },
        status
      );
      await this.receipts.put(receipt);
      return receipt;
    } catch (err) {
      const receipt = failureReceipt(base, err);
      await this.receipts.put(receipt);
      return receipt;
    }
  }

  /**
   * Liquidate a loan, but only if the protocol says it is liquidatable.
   *
   * The read and the write happen inside a single KeeperHub call, so there is
   * no window between "is it liquidatable?" and "liquidate it" for another
   * keeper -- or a last-second repayment -- to invalidate the decision. A
   * condition that does not hold costs nothing and sends nothing.
   */
  async liquidateIfUnhealthy(params: LiquidateParams): Promise<Receipt> {
    const attempt = params.attempt ?? 1;
    const actionId = `loan-${params.loanId}-liquidate`;
    const base = {
      actionId,
      kind: "liquidation" as const,
      loanId: params.loanId,
      chainId: Number(this.deployment.chainId),
      attempt,
    };

    try {
      const result = await this.kh.checkAndExecute(
        {
          contractAddress: this.deployment.loanEngine,
          chainId: this.deployment.chainId,
          functionName: "checkLiquidatable",
          functionArgs: encodeArgs([params.loanId]),
          abi: LOAN_ENGINE_ABI,
          condition: { operator: "eq", value: "true" },
          action: {
            contractAddress: this.deployment.loanEngine,
            functionName: "liquidate",
            functionArgs: encodeArgs([params.loanId]),
            abi: LOAN_ENGINE_ABI,
          },
        },
        { idempotencyKey: chargeKey(actionId, attempt) }
      );

      if (!("executionId" in result)) {
        // Healthy loan. This is the overwhelmingly common path and is a
        // success, not a failure -- record it so the run log shows coverage.
        const receipt: Receipt = {
          ...base,
          outcome: "skipped",
          createdAt: new Date().toISOString(),
        };
        await this.receipts.put(receipt);
        return receipt;
      }

      const status = await this.kh.waitForTerminal(result.executionId);
      const receipt = receiptFromStatus(base, status);
      await this.receipts.put(receipt);
      return receipt;
    } catch (err) {
      const receipt = failureReceipt(base, err);
      await this.receipts.put(receipt);
      return receipt;
    }
  }

  /** Pay a merchant out of the escrow. */
  async settleMerchant(params: SettleMerchantParams): Promise<Receipt> {
    const attempt = params.attempt ?? 1;
    const actionId = `merchant-${params.merchantId}-order-${params.orderId}`;
    const call = {
      contractAddress: params.escrowAddress,
      chainId: this.deployment.chainId,
      functionName: "settlePayment",
      functionArgs: encodeArgs([
        params.amountRaw,
        params.orderId,
        params.details ?? "",
      ]),
      abi: MERCHANT_ESCROW_ABI,
    };

    const base = {
      actionId,
      kind: "merchant_settlement" as const,
      merchantId: params.merchantId,
      amount: params.amountDisplay ?? params.amountRaw,
      chainId: Number(this.deployment.chainId),
      attempt,
    };

    try {
      const sim = await this.kh.assertWouldSucceed(call);
      const status = await this.kh.executeAndConfirm(call, {
        idempotencyKey: chargeKey(actionId, attempt),
      });
      const receipt = receiptFromStatus(
        { ...base, simulation: { ok: true, gasEstimate: sim?.gasEstimate } },
        status
      );
      await this.receipts.put(receipt);
      return receipt;
    } catch (err) {
      const receipt = failureReceipt(base, err);
      await this.receipts.put(receipt);
      return receipt;
    }
  }
}

function failureReceipt(
  base: Omit<Receipt, "outcome" | "createdAt">,
  err: unknown
): Receipt {
  const khErr = isKeeperHubError(err)
    ? err
    : new KeeperHubError("unknown", (err as Error)?.message ?? String(err));
  return {
    ...base,
    outcome: "failed",
    simulation:
      khErr.kind === "would_revert" || khErr.kind === "insufficient_funds"
        ? { ok: false, revertReason: khErr.details ?? khErr.message }
        : base.simulation,
    error: { kind: khErr.kind, message: khErr.message },
    createdAt: new Date().toISOString(),
  };
}
