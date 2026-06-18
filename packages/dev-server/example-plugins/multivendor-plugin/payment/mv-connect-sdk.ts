/**
 * @description
 * A fake payment API based loosely on the Stripe Connect multiparty payments flow
 * described here: https://stripe.com/docs/connect/charges-transfers
 */
export class MyConnectSdk {
    constructor(private options: { apiKey: string }) {}

    /**
     * Used to create a payment on the platform itself.
     */
    async createPayment(options: { amount: number; currency: string; transfer_group: string }) {
        return { transactionId: Math.random().toString(36).substring(3) };
    }

    /**
     * Used to create a transfer payment to a Seller.
     */
    async createTransfer(options: {
        amount: number;
        currency: string;
        connectedAccountId: string;
        transfer_group: string;
    }) {
        return { transactionId: Math.random().toString(36).substring(3) };
    }
}
