import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { AddressBlock, EmailFulfillment, EmailOrder, FulfillmentSummary } from '../../components/order-blocks';
import { defineEmailTemplate } from '../../template/email-template';

export interface OrderShippedProps {
    order: EmailOrder;
    fulfillment: EmailFulfillment;
    branding?: EmailBranding;
}

export const OrderShippedTemplate = defineEmailTemplate<OrderShippedProps>({
    subject: ({ order }) => `Your order #${order.code} is on its way`,
    body: ({ order, fulfillment, branding }) => (
        <EmailLayout title="Your order is on its way" preview={`Order ${order.code} has shipped`} branding={branding}>
            <EmailSection>
                <EmailTitle>Your order is on its way</EmailTitle>
                <EmailText>
                    Good news: items from order <strong>{order.code}</strong> have shipped.
                    {fulfillment.trackingCode ? ' Use the tracking number below to follow the delivery.' : ''}
                </EmailText>
            </EmailSection>
            <EmailSection>
                <EmailHeading>In this shipment</EmailHeading>
                <FulfillmentSummary fulfillment={fulfillment} />
            </EmailSection>
            {order.shippingAddress ? (
                <EmailSection>
                    <EmailHeading>Shipping to</EmailHeading>
                    <AddressBlock address={order.shippingAddress} />
                </EmailSection>
            ) : null}
        </EmailLayout>
    ),
});
