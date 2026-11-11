import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle, Money } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { EmailOrder, OrderSummary } from '../../components/order-blocks';
import { defineEmailTemplate } from '../../template/email-template';

export interface EmailPayment {
    amount: number;
    method: string;
    errorMessage?: string | null;
}

export interface PaymentFailedProps {
    order: EmailOrder;
    payment: EmailPayment;
    branding?: EmailBranding;
}

export const PaymentFailedTemplate = defineEmailTemplate<PaymentFailedProps>({
    subject: ({ order }) => `Payment for your order #${order.code} failed`,
    body: ({ order, payment, branding }) => (
        <EmailLayout title="Payment failed" preview={`We could not take payment for order ${order.code}`} branding={branding}>
            <EmailSection>
                <EmailTitle>Your payment did not go through</EmailTitle>
                <EmailText>
                    We could not take your payment of{' '}
                    <strong>
                        <Money value={payment.amount} currencyCode={order.currencyCode} />
                    </strong>{' '}
                    for order <strong>{order.code}</strong>, so the order has not been placed yet.
                </EmailText>
                <EmailText>
                    Please try again with another payment method. If the problem continues, contact us and we will
                    help.
                </EmailText>
            </EmailSection>
            <EmailSection>
                <EmailHeading>Your order</EmailHeading>
                <OrderSummary order={order} />
            </EmailSection>
        </EmailLayout>
    ),
});
