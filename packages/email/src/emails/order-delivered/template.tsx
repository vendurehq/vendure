import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { EmailFulfillment, EmailOrder, FulfillmentSummary } from '../../components/order-blocks';
import { defineEmailTemplate } from '../../template/email-template';

export interface OrderDeliveredProps {
    order: EmailOrder;
    fulfillment: EmailFulfillment;
    branding?: EmailBranding;
}

export const OrderDeliveredTemplate = defineEmailTemplate<OrderDeliveredProps>({
    subject: ({ order }) => `Your order #${order.code} has been delivered`,
    body: ({ order, fulfillment, branding }) => (
        <EmailLayout title="Your order has been delivered" preview={`Order ${order.code} has been delivered`} branding={branding}>
            <EmailSection>
                <EmailTitle>Your order has been delivered</EmailTitle>
                <EmailText>
                    Items from order <strong>{order.code}</strong> have been delivered. We hope you enjoy them.
                </EmailText>
            </EmailSection>
            <EmailSection>
                <EmailHeading>Delivered items</EmailHeading>
                <FulfillmentSummary fulfillment={fulfillment} />
            </EmailSection>
        </EmailLayout>
    ),
});
