export { };

// Mock repository for PaymentSessions
const paymentSessions: Record<string, any> = {};

export async function createPaymentSession(params: any): Promise<any> {
    const session = { id: params.id, ...params, status: "pending", createdAt: new Date() };
    paymentSessions[params.id] = session;
    return session;
}

export async function getPaymentSession(id: string): Promise<any> {
    return paymentSessions[id];
}
