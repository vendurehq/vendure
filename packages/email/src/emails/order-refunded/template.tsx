import { EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle, Money } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { EmailOrder } from '../../components/order-blocks';
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
    subject: ({ order }) => `Refund for your order #${order.code}`,
    body: ({ order, refund, branding }) => (
        <EmailLayout title="Refund issued" preview={`A refund for order ${order.code} is on its way`} branding={branding}>
            <EmailSection>
                <EmailTitle>We have issued a refund</EmailTitle>
                <EmailText>
                    We have refunded part or all of order <strong>{order.code}</strong>
                    {refund.method ? ` to your original payment method (${refund.method})` : ''}.
                </EmailText>
            </EmailSection>
            <EmailSection variant="muted">
                <EmailMutedText>Refund amount</EmailMutedText>
                <EmailText style={{ margin: 0, fontSize: '28px', lineHeight: '36px', fontWeight: 600, color: '#09090b' }}>
                    <Money value={refund.total} currencyCode={order.currencyCode} />
                </EmailText>
                {refund.reason ? (
                    <EmailText style={{ margin: '8px 0 0', fontSize: '14px' }}>Reason: {refund.reason}</EmailText>
                ) : null}
            </EmailSection>
            <EmailSection>
                <EmailText style={{ margin: '16px 0 0' }}>
                    Depending on your bank, it can take 5 to 10 business days for the money to reach your account.
                </EmailText>
            </EmailSection>
        </EmailLayout>
    ),
});
