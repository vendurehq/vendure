import {
    EmailLayout,
    EmailMutedText,
    EmailSection,
    EmailText,
    EmailTitle,
    emailTheme,
    Money,
} from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { formatMoney } from '../../components/formatting';
import { EmailOrder } from '../../components/order-blocks';
import { orderVariables } from '../../components/order-variables';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface EmailRefund {
    total: number;
    method?: string | null;
    reason?: string | null;
}

export interface OrderRefundedProps {
    order: EmailOrder;
    refund: EmailRefund;
    branding?: EmailBranding;
}

export const OrderRefundedTemplate = defineEmailTemplate<OrderRefundedProps>({
    content: {
        subject: { label: 'Subject', default: 'Refund for your order #{{ orderCode }}' },
        preview: { label: 'Inbox preview text', default: 'A refund for order {{ orderCode }} is on its way' },
        title: { label: 'Title', default: 'We have issued a refund' },
        intro: {
            label: 'Introduction',
            default: 'We have refunded part or all of order {{ orderCode }} to your original payment method.',
            multiline: true,
        },
        amountLabel: { label: 'Amount label', default: 'Refund amount' },
        note: {
            label: 'Note',
            default: 'Depending on your bank, it can take 5 to 10 business days for the money to reach your account.',
            multiline: true,
        },
    },
    variables: {
        ...orderVariables<OrderRefundedProps>(),
        refundAmount: {
            label: 'Refund amount',
            value: ({ order, refund }, { languageCode }) => formatMoney(refund.total, order.currencyCode, languageCode),
        },
        refundReason: { label: 'Refund reason', value: ({ refund }) => refund.reason },
        paymentMethod: { label: 'Payment method', value: ({ refund }) => refund.method },
    },
    body: ({ order, refund, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                </EmailSection>
                <EmailSection variant="muted">
                    <EmailMutedText>{content.amountLabel}</EmailMutedText>
                    <EmailText
                        style={{
                            margin: 0,
                            fontSize: '28px',
                            lineHeight: '36px',
                            fontWeight: 600,
                            color: emailTheme.heading,
                        }}
                    >
                        <Money value={refund.total} currencyCode={order.currencyCode} />
                    </EmailText>
                    {refund.reason ? (
                        <EmailText style={{ margin: '8px 0 0', fontSize: '14px' }}>{refund.reason}</EmailText>
                    ) : null}
                </EmailSection>
                <EmailSection>
                    <EmailText style={{ margin: '16px 0 0' }}>{content.note}</EmailText>
                </EmailSection>
            </EmailLayout>
        );
    },
});
