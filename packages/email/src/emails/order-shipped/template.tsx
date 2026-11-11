import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { AddressBlock, EmailFulfillment, EmailOrder, FulfillmentSummary } from '../../components/order-blocks';
import { orderVariables } from '../../components/order-variables';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface OrderShippedProps {
    order: EmailOrder;
    fulfillment: EmailFulfillment;
    branding?: EmailBranding;
}

export const OrderShippedTemplate = defineEmailTemplate<OrderShippedProps>({
    content: {
        subject: { label: 'Subject', default: 'Your order #{{ orderCode }} is on its way' },
        preview: { label: 'Inbox preview text', default: 'Order {{ orderCode }} has shipped' },
        title: { label: 'Title', default: 'Your order is on its way' },
        intro: {
            label: 'Introduction',
            default: 'Good news: items from order {{ orderCode }} have shipped.',
            multiline: true,
        },
        shipmentHeading: { label: 'Shipment heading', default: 'In this shipment' },
        addressHeading: { label: 'Address heading', default: 'Shipping to' },
    },
    variables: {
        ...orderVariables<OrderShippedProps>(),
        shippingMethod: { label: 'Shipping method', value: ({ fulfillment }) => fulfillment.method },
        trackingCode: { label: 'Tracking number', value: ({ fulfillment }) => fulfillment.trackingCode },
    },
    body: ({ order, fulfillment, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                </EmailSection>
                <EmailSection>
                    <EmailHeading>{content.shipmentHeading}</EmailHeading>
                    <FulfillmentSummary fulfillment={fulfillment} />
                </EmailSection>
                {order.shippingAddress ? (
                    <EmailSection>
                        <EmailHeading>{content.addressHeading}</EmailHeading>
                        <AddressBlock address={order.shippingAddress} />
                    </EmailSection>
                ) : null}
            </EmailLayout>
        );
    },
});
