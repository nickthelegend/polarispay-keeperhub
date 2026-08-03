export {
  closeDb,
  collections,
  ensureIndexes,
  getDb,
  mongoUri,
  ping,
} from "./client.ts";

export {
  buildInstallments,
  formatUnits,
  MongoLoanBook,
  MongoReceiptStore,
  recordEvent,
} from "./loanbook.ts";
export type { BookLoan } from "./loanbook.ts";

export { COLLECTIONS, INDEXES } from "./schema.ts";
export type {
  EventDoc,
  InstallmentDoc,
  InstallmentState,
  LoanDoc,
  LoanStatus,
  MerchantDoc,
  MerchantStatus,
  ReceiptDoc,
} from "./schema.ts";
