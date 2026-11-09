import { EmailHeading, EmailLayout, EmailSection, EmailText } from '../components/blocks';
import { EmailBranding } from '../components/branding';
import {
    AddressBlock,
    EmailOrder,
    EmailShippingLine,
    OrderHighlights,
    OrderSummary,
} from '../components/order-blocks';
import { defineEmailTemplate } from '../template/email-template';

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export interface OrderConfirmationEmailProps {
    order: EmailOrder;
    shippingLines: EmailShippingLine[];
    branding?: EmailBranding;
}

/**
 * @description
 * The default template of the `order-confirmation` email, used by the {@link orderConfirmationHandler}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Default email templates
 * @since 4.0.0
 */
export const OrderConfirmationEmail = defineEmailTemplate<OrderConfirmationEmailProps>(
    ({ order, shippingLines, branding }) => {
        const customerName = [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ');
        return (
            <EmailLayout
                title="Order Receipt"
                preview={`Thank you for your order ${order.code}`}
                branding={branding}
            >
                <EmailSection variant="muted">
                    <EmailText>{customerName ? `Dear ${customerName},` : 'Hello,'}</EmailText>
                    <EmailText>Thank you for your order!</EmailText>
                </EmailSection>
                <OrderHighlights order={order} />
                {order.shippingAddress ? (
                    <EmailSection variant="muted">
                        <AddressBlock heading="Shipping To" address={order.shippingAddress} />
                    </EmailSection>
                ) : null}
                <EmailSection>
                    <EmailHeading>Order Summary</EmailHeading>
                    <OrderSummary order={order} shippingLines={shippingLines} />
                </EmailSection>
            </EmailLayout>
        );
    },
);
