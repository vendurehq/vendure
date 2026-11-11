import { EmailHeading, EmailLayout, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import {
    AddressBlock,
    EmailOrder,
    EmailShippingLine,
    OrderHighlights,
    OrderSummary,
} from '../../components/order-blocks';
import { defineEmailTemplate } from '../../template/email-template';

export interface OrderConfirmationProps {
    order: EmailOrder;
    shippingLines: EmailShippingLine[];
    branding?: EmailBranding;
}

export const OrderConfirmationTemplate = defineEmailTemplate<OrderConfirmationProps>({
    subject: ({ order }) => `Order confirmation for #${order.code}`,
    body: ({ order, shippingLines, branding }) => {
        const firstName = order.customer?.firstName;
        return (
            <EmailLayout title="Order confirmation" preview={`Thanks for your order ${order.code}`} branding={branding}>
                <EmailSection>
                    <EmailTitle>{firstName ? `Thanks for your order, ${firstName}` : 'Thanks for your order'}</EmailTitle>
                    <EmailText>
                        We have received your order and are getting it ready. We will email you again when it ships.
                    </EmailText>
                </EmailSection>
                <OrderHighlights order={order} />
                <EmailSection>
                    <EmailHeading>Order summary</EmailHeading>
                    <OrderSummary order={order} shippingLines={shippingLines} />
                </EmailSection>
                {order.shippingAddress ? (
                    <EmailSection>
                        <EmailHeading>Shipping to</EmailHeading>
                        <AddressBlock address={order.shippingAddress} />
                    </EmailSection>
                ) : null}
            </EmailLayout>
        );
    },
});
