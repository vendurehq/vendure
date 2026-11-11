import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { EmailOrder, OrderSummary } from '../../components/order-blocks';
import { orderVariables } from '../../components/order-variables';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface OrderCancelledProps {
    order: EmailOrder;
    branding?: EmailBranding;
}

export const OrderCancelledTemplate = defineEmailTemplate<OrderCancelledProps>({
    content: {
        subject: { label: 'Subject', default: 'Your order #{{ orderCode }} has been cancelled' },
        preview: { label: 'Inbox preview text', default: 'Order {{ orderCode }} has been cancelled' },
        title: { label: 'Title', default: 'Your order has been cancelled' },
        intro: {
            label: 'Introduction',
            default:
                'Order {{ orderCode }} has been cancelled. If you already paid, we will email you when the refund is issued.',
            multiline: true,
        },
        itemsHeading: { label: 'Items heading', default: 'Cancelled items' },
    },
    variables: orderVariables(),
    body: ({ order, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                </EmailSection>
                <EmailSection>
                    <EmailHeading>{content.itemsHeading}</EmailHeading>
                    <OrderSummary order={order} />
                </EmailSection>
            </EmailLayout>
        );
    },
});
