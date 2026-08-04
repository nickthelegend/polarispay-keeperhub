export {
  closeDb,
  collections,
  ensureIndexes,
  getDb,
  mongoUri,
  ping,
} from "./client.js";

export {
  buildInstallments,
  formatUnits,
  MongoLoanBook,
  MongoReceiptStore,
  recordEvent,
} from "./loanbook.js";
export type { BookLoan } from "./loanbook.js";

export { COLLECTIONS, INDEXES } from "./schema.js";
export type {
  EventDoc,
  InstallmentDoc,
  InstallmentState,
  LoanDoc,
  LoanStatus,
  MerchantDoc,
  MerchantStatus,
  ReceiptDoc,
} from "./schema.js";

export {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  merchantForApiKey,
  onboardMerchant,
  rotateApiKey,
  setMerchantStatus,
  settlementCsv,
} from './merchants.js';
export type { OnboardResult } from './merchants.js';

export {
  deliverWebhook,
  SIGNATURE_TOLERANCE_SECONDS,
  signPayload,
  verifySignature,
} from './webhooks.js';
export type { DeliveryResult, WebhookEvent, WebhookPayload } from './webhooks.js';
