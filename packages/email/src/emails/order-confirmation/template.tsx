import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import {
    AddressBlock,
    EmailOrder,
    EmailShippingLine,
    OrderHighlights,
    OrderSummary,
} from '../../components/order-blocks';
import { orderVariables } from '../../components/order-variables';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface OrderConfirmationProps {
    order: EmailOrder;
    shippingLines: EmailShippingLine[];
    branding?: EmailBranding;
}

export const OrderConfirmationTemplate = defineEmailTemplate<OrderConfirmationProps>({
    content: {
        subject: { label: 'Subject', default: 'Order confirmation for #{{ orderCode }}' },
        preview: { label: 'Inbox preview text', default: 'Thanks for your order {{ orderCode }}' },
        title: { label: 'Title', default: 'Thanks for your order' },
        intro: {
            label: 'Introduction',
            default: 'We have received your order and are getting it ready. We will email you again when it ships.',
            multiline: true,
        },
        summaryHeading: { label: 'Order summary heading', default: 'Order summary' },
        addressHeading: { label: 'Address heading', default: 'Shipping to' },
    },
    variables: orderVariables(),
    body: ({ order, shippingLines, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                </EmailSection>
                <OrderHighlights order={order} />
                <EmailSection>
                    <EmailHeading>{content.summaryHeading}</EmailHeading>
                    <OrderSummary order={order} shippingLines={shippingLines} />
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
