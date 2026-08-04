/**
 * Loan-total arithmetic.
 *
 * This exists because of a bug found on live Sepolia data: two instalments were
 * marked paid in the book while the loan's totalRepaidRaw had only moved once.
 * The keeper recorded the instalment state on collection but left the loan
 * total to a separate chain sync, so between the two the book contradicted
 * itself -- and the borrower's dashboard told them they owed 450.02 when the
 * contract said 300.01.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { repaidAfterCollecting } from "../dist/index.js";

/** A four-instalment plan of 150.00 each on a 600.03 total, as deployed. */
const PLAN = { totalOwedRaw: "600027397", amountRaw: "150006850" };

describe("repaidAfterCollecting", () => {
  it("adds the instalment to the running total", () => {
    assert.equal(
      repaidAfterCollecting({ ...PLAN, totalRepaidRaw: "150006850" }),
      "300013700"
    );
  });

  it("starts from zero on the first collection", () => {
    assert.equal(repaidAfterCollecting({ ...PLAN, totalRepaidRaw: "0" }), "150006850");
  });

  it("caps the final instalment at what is still owed", () => {
    // Three collected, 150.00 left on the schedule but only 150.006847 owed.
    // Crediting the raw amount would claim the loan was overpaid.
    const after = repaidAfterCollecting({ ...PLAN, totalRepaidRaw: "450020550" });
    assert.equal(after, PLAN.totalOwedRaw);
    assert.ok(BigInt(after) <= BigInt(PLAN.totalOwedRaw));
  });

  it("never exceeds the total however many times it is applied", () => {
    let repaid = "0";
    for (let i = 0; i < 10; i++) {
      repaid = repaidAfterCollecting({ ...PLAN, totalRepaidRaw: repaid });
    }
    assert.equal(repaid, PLAN.totalOwedRaw);
  });

  it("credits nothing once the loan is fully repaid", () => {
    assert.equal(
      repaidAfterCollecting({ ...PLAN, totalRepaidRaw: PLAN.totalOwedRaw }),
      PLAN.totalOwedRaw
    );
  });

  it("does not go backwards if the book already reads over the total", () => {
    // Defensive: a loan repaid out of band could leave repaid above owed, and
    // the fix for that is reconciliation, not silently subtracting here.
    const over = (BigInt(PLAN.totalOwedRaw) + 1n).toString();
    assert.equal(repaidAfterCollecting({ ...PLAN, totalRepaidRaw: over }), over);
  });

  it("walks a full plan to exactly the amount owed", () => {
    let repaid = "0";
    const steps: string[] = [];
    for (let i = 0; i < 4; i++) {
      repaid = repaidAfterCollecting({ ...PLAN, totalRepaidRaw: repaid });
      steps.push(repaid);
    }
    assert.deepEqual(steps, ["150006850", "300013700", "450020550", "600027397"]);
  });
});
