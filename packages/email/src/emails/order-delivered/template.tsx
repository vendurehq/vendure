import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { EmailFulfillment, EmailOrder, FulfillmentSummary } from '../../components/order-blocks';
import { orderVariables } from '../../components/order-variables';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface OrderDeliveredProps {
    order: EmailOrder;
    fulfillment: EmailFulfillment;
    branding?: EmailBranding;
}

export const OrderDeliveredTemplate = defineEmailTemplate<OrderDeliveredProps>({
    content: {
        subject: { label: 'Subject', default: 'Your order #{{ orderCode }} has been delivered' },
        preview: { label: 'Inbox preview text', default: 'Order {{ orderCode }} has been delivered' },
        title: { label: 'Title', default: 'Your order has been delivered' },
        intro: {
            label: 'Introduction',
            default: 'Items from order {{ orderCode }} have been delivered. We hope you enjoy them.',
            multiline: true,
        },
        itemsHeading: { label: 'Items heading', default: 'Delivered items' },
    },
    variables: {
        ...orderVariables<OrderDeliveredProps>(),
        shippingMethod: { label: 'Shipping method', value: ({ fulfillment }) => fulfillment.method },
        trackingCode: { label: 'Tracking number', value: ({ fulfillment }) => fulfillment.trackingCode },
    },
    body: ({ fulfillment, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                </EmailSection>
                <EmailSection>
                    <EmailHeading>{content.itemsHeading}</EmailHeading>
                    <FulfillmentSummary fulfillment={fulfillment} />
                </EmailSection>
            </EmailLayout>
        );
    },
});
