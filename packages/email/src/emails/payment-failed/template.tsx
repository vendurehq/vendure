import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { formatMoney } from '../../components/formatting';
import { EmailOrder, OrderSummary } from '../../components/order-blocks';
import { orderVariables } from '../../components/order-variables';
import { useEmailContent } from '../../template/email-content';
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
    content: {
        subject: { label: 'Subject', default: 'Payment for your order #{{ orderCode }} failed' },
        preview: { label: 'Inbox preview text', default: 'We could not take payment for order {{ orderCode }}' },
        title: { label: 'Title', default: 'Your payment did not go through' },
        intro: {
            label: 'Introduction',
            default:
                'We could not take your payment of {{ paymentAmount }} for order {{ orderCode }}, so the order has not been placed yet.\n\n' +
                'Please try again with another payment method. If the problem continues, contact us and we will help.',
            multiline: true,
        },
        summaryHeading: { label: 'Order summary heading', default: 'Your order' },
    },
    variables: {
        ...orderVariables<PaymentFailedProps>(),
        paymentAmount: {
            label: 'Payment amount',
            value: ({ order, payment }, { languageCode }) =>
                formatMoney(payment.amount, order.currencyCode, languageCode),
        },
        paymentMethod: { label: 'Payment method', value: ({ payment }) => payment.method },
    },
    body: ({ order, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                </EmailSection>
                <EmailSection>
                    <EmailHeading>{content.summaryHeading}</EmailHeading>
                    <OrderSummary order={order} />
                </EmailSection>
            </EmailLayout>
        );
    },
});
