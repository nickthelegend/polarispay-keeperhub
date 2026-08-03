import { shopify } from "../shopify.server";

// GraphQL Mutations
const RESOLVE_PAYMENT_SESSION = `
  mutation paymentSessionResolve($id: ID!) {
    paymentSessionResolve(id: $id) {
      paymentSession {
        id
        status {
          code
        }
        nextAction {
          action
          context {
            ... on PaymentSessionActionsRedirect {
              redirectUrl
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const REJECT_PAYMENT_SESSION = `
  mutation paymentSessionReject($id: ID!, $reason: PaymentSessionRejectionReasonInput!) {
    paymentSessionReject(id: $id, reason: $reason) {
      paymentSession {
        id
        status {
          code
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PENDING_PAYMENT_SESSION = `
  mutation paymentSessionPending($id: ID!, $pendingExpiresAt: DateTime!, $reason: PaymentSessionPendingReasonInput!) {
    paymentSessionPending(id: $id, pendingExpiresAt: $pendingExpiresAt, reason: $reason) {
      paymentSession {
        id
        status {
          code
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export class PaymentsAppsClient {
    private client: any;

    constructor(session: any) {
        this.client = new shopify.clients.Graphql({ session });
    }

    async resolveSession(sessionId: string) {
        const response = await this.client.query({
            data: {
                query: RESOLVE_PAYMENT_SESSION,
                variables: { id: sessionId },
            },
        });
        return response.body.data.paymentSessionResolve;
    }

    async rejectSession(sessionId: string, code: string, merchantMessage: string) {
        const response = await this.client.query({
            data: {
                query: REJECT_PAYMENT_SESSION,
                variables: {
                    id: sessionId,
                    reason: {
                        code,
                        merchantMessage,
                    },
                },
            },
        });
        return response.body.data.paymentSessionReject;
    }

    async pendSession(sessionId: string, expiresAt: Date, reason: string) {
        const response = await this.client.query({
            data: {
                query: PENDING_PAYMENT_SESSION,
                variables: {
                    id: sessionId,
                    pendingExpiresAt: expiresAt.toISOString(),
                    reason: { code: reason },
                },
            },
        });
        return response.body.data.paymentSessionPending;
    }
}
