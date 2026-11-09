import { Column } from '@react-email/column';
import { Img } from '@react-email/img';
import { Row } from '@react-email/row';
import { Text } from '@react-email/text';
import type { CSSProperties } from 'react';

import { EmailHeading, EmailSection, FormattedDate, Money } from './blocks';
import { useEmailBranding } from './branding';

/**
 * @description
 * Add this class to a `<table>` of data (as opposed to a layout table) so that the plain text version
 * of the email renders each of its rows on its own line.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export const EMAIL_DATA_TABLE_CLASS = 'email-data-table';

/*
 * The props of the order components are minimal structural types rather than the Order entity, so
 * that they accept an Order entity, its JSON-serialized form (which is what templates receive after
 * the job queue), or plain sample data, e.g. from an email editor.
 */

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export interface EmailOrderAddress {
    fullName?: string | null;
    company?: string | null;
    streetLine1?: string | null;
    streetLine2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
    phoneNumber?: string | null;
}

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export interface EmailOrderLine {
    quantity: number;
    discountedLinePriceWithTax: number;
    productVariant: { name: string };
    featuredAsset?: { preview: string } | null;
}

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export interface EmailShippingLine {
    priceWithTax: number;
    shippingMethod?: { name: string } | null;
}

/**
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export interface EmailOrder {
    code: string;
    currencyCode: string;
    orderPlacedAt?: Date | string | null;
    subTotalWithTax: number;
    totalWithTax: number;
    lines: EmailOrderLine[];
    discounts?: Array<{ description: string; amountWithTax: number }>;
    shippingAddress?: EmailOrderAddress | null;
    customer?: { firstName?: string | null; lastName?: string | null } | null;
}

/**
 * @description
 * A highlighted row with the order code, order date and total.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function OrderHighlights({ order }: { order: EmailOrder }) {
    const { primaryTextColor } = useEmailBranding();
    const label: CSSProperties = { margin: 0, fontSize: '14px', fontWeight: 'bold', color: primaryTextColor };
    const value: CSSProperties = { margin: '4px 0 0', fontSize: '14px', color: primaryTextColor };
    return (
        <EmailSection variant="highlight">
            <Row>
                <Column align="center">
                    <Text style={label}>Order Code</Text>
                    <Text style={value}>{order.code}</Text>
                </Column>
                <Column align="center">
                    <Text style={label}>Order Date</Text>
                    <Text style={value}>
                        <FormattedDate value={order.orderPlacedAt} />
                    </Text>
                </Column>
                <Column align="center">
                    <Text style={label}>Total Price</Text>
                    <Text style={value}>
                        <Money value={order.totalWithTax} currencyCode={order.currencyCode} />
                    </Text>
                </Column>
            </Row>
        </EmailSection>
    );
}

/**
 * @description
 * An address, one field per line, preceded by an optional heading.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function AddressBlock({ heading, address }: { heading?: string; address?: EmailOrderAddress | null }) {
    if (!address) {
        return null;
    }
    const lines = [
        address.company,
        address.streetLine1,
        address.streetLine2,
        address.city,
        address.province,
        address.postalCode,
        address.country,
        address.phoneNumber,
    ].filter(Boolean);
    return (
        <>
            {heading ? <EmailHeading>{heading}</EmailHeading> : null}
            <Text style={{ margin: 0, fontSize: '15px', lineHeight: '22px', color: '#525252' }}>
                {address.fullName ? (
                    <>
                        <strong>{address.fullName}</strong>
                        <br />
                    </>
                ) : null}
                {lines.map((line, i) => (
                    <span key={i}>
                        {line}
                        <br />
                    </span>
                ))}
            </Text>
        </>
    );
}

const cell: CSSProperties = {
    padding: '8px 6px',
    borderBottom: '1px dashed #eeeeee',
    fontSize: '14px',
    color: '#333333',
};
const amountCell: CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };

/**
 * @description
 * A table of the order lines, followed by the discounts, sub-total, shipping and total.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function OrderSummary({
    order,
    shippingLines = [],
}: {
    order: EmailOrder;
    shippingLines?: EmailShippingLine[];
}) {
    const currencyCode = order.currencyCode;
    return (
        <table
            className={EMAIL_DATA_TABLE_CLASS}
            width="100%"
            cellPadding={0}
            cellSpacing={0}
            role="presentation"
            style={{ borderCollapse: 'collapse' }}
        >
            <tbody>
                {order.lines.map((line, i) => (
                    <tr key={`line-${i}`}>
                        <td style={{ ...cell, width: '56px' }}>
                            {line.featuredAsset?.preview ? (
                                <Img
                                    src={withPreset(line.featuredAsset.preview)}
                                    alt={line.productVariant.name}
                                    width="50"
                                    height="50"
                                />
                            ) : null}
                        </td>
                        <td style={cell}>{`${line.quantity} x ${line.productVariant.name}`}</td>
                        <td style={amountCell}>
                            <Money value={line.discountedLinePriceWithTax} currencyCode={currencyCode} />
                        </td>
                    </tr>
                ))}
                {(order.discounts ?? []).map((discount, i) => (
                    <tr key={`discount-${i}`}>
                        <td style={cell} colSpan={2}>
                            {discount.description}
                        </td>
                        <td style={amountCell}>
                            <Money value={discount.amountWithTax} currencyCode={currencyCode} />
                        </td>
                    </tr>
                ))}
                <tr>
                    <td style={cell} colSpan={2}>
                        Sub-total:
                    </td>
                    <td style={amountCell}>
                        <Money value={order.subTotalWithTax} currencyCode={currencyCode} />
                    </td>
                </tr>
                {shippingLines.map((shippingLine, i) => (
                    <tr key={`shipping-${i}`}>
                        <td style={cell} colSpan={2}>
                            {shippingLine.shippingMethod
                                ? `Shipping (${shippingLine.shippingMethod.name}):`
                                : 'Shipping:'}
                        </td>
                        <td style={amountCell}>
                            <Money value={shippingLine.priceWithTax} currencyCode={currencyCode} />
                        </td>
                    </tr>
                ))}
                <tr>
                    <td style={{ ...cell, fontWeight: 'bold' }} colSpan={2}>
                        Total:
                    </td>
                    <td style={{ ...amountCell, fontWeight: 'bold' }}>
                        <Money value={order.totalWithTax} currencyCode={currencyCode} />
                    </td>
                </tr>
            </tbody>
        </table>
    );
}

function withPreset(url: string) {
    return `${url}${url.includes('?') ? '&' : '?'}w=50&h=50`;
}
