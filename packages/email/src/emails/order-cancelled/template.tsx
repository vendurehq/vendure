import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { EmailOrder, OrderSummary } from '../../components/order-blocks';
import { defineEmailTemplate } from '../../template/email-template';

export interface OrderCancelledProps {
    order: EmailOrder;
    branding?: EmailBranding;
}

export const OrderCancelledTemplate = defineEmailTemplate<OrderCancelledProps>({
    subject: ({ order }) => `Your order #${order.code} has been cancelled`,
    body: ({ order, branding }) => (
        <EmailLayout title="Order cancelled" preview={`Order ${order.code} has been cancelled`} branding={branding}>
            <EmailSection>
                <EmailTitle>Your order has been cancelled</EmailTitle>
                <EmailText>
                    Order <strong>{order.code}</strong> has been cancelled. If you already paid, we will email you
                    when the refund is issued.
                </EmailText>
            </EmailSection>
            <EmailSection>
                <EmailHeading>Cancelled items</EmailHeading>
                <OrderSummary order={order} />
            </EmailSection>
        </EmailLayout>
    ),
});
