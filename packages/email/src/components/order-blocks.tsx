import { Column } from '@react-email/column';
import { Img } from '@react-email/img';
import { Row } from '@react-email/row';
import { Section } from '@react-email/section';
import { Text } from '@react-email/text';
import type { CSSProperties, ReactNode } from 'react';

import { emailTheme, FormattedDate, Money } from './blocks';

export const EMAIL_DATA_TABLE_CLASS = 'email-data-table';

/*
 * The props of the order components are minimal structural types rather than the Order entity, so
 * that they accept an Order entity, its JSON-serialized form (which is what templates receive after
 * the job queue), or plain sample data, e.g. from an email editor.
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
 * @docsCategory core plugins/Email
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
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export interface EmailShippingLine {
    priceWithTax: number;
    shippingMethod?: { name: string } | null;
}

/**
 * @docsCategory core plugins/Email
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

const label: CSSProperties = {
    margin: 0,
    fontSize: '12px',
    lineHeight: '18px',
    color: emailTheme.muted,
};
const value: CSSProperties = {
    margin: '2px 0 0',
    fontSize: '14px',
    lineHeight: '20px',
    fontWeight: 600,
    color: emailTheme.heading,
};

function Box({ children }: { children?: ReactNode }) {
    return (
        <Section style={{ padding: `8px ${emailTheme.gutter}` }}>
            <Section
                style={{
                    border: `1px solid ${emailTheme.border}`,
                    borderRadius: '8px',
                    padding: '14px 16px',
                }}
            >
                {children}
            </Section>
        </Section>
    );
}

/**
 * @description
 * The order number, date and total in a row of three. Place it directly in {@link EmailLayout}.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function OrderHighlights({ order }: { order: EmailOrder }) {
    return (
        <Box>
            <Row>
                <Column style={{ width: '40%', verticalAlign: 'top' }}>
                    <Text style={label}>Order number</Text>
                    <Text style={value}>{order.code}</Text>
                </Column>
                <Column style={{ width: '30%', verticalAlign: 'top' }}>
                    <Text style={label}>Date</Text>
                    <Text style={value}>
                        <FormattedDate value={order.orderPlacedAt} />
                    </Text>
                </Column>
                <Column style={{ width: '30%', verticalAlign: 'top', textAlign: 'right' }}>
                    <Text style={label}>Total</Text>
                    <Text style={value}>
                        <Money value={order.totalWithTax} currencyCode={order.currencyCode} />
                    </Text>
                </Column>
            </Row>
        </Box>
    );
}

/**
 * @description
 * A postal address, with an optional small heading such as "Shipping to".
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function AddressBlock({ heading, address }: { heading?: string; address?: EmailOrderAddress | null }) {
    if (!address) {
        return null;
    }
    const cityLine = [address.postalCode, address.city].filter(Boolean).join(' ');
    const lines = [
        address.company,
        address.streetLine1,
        address.streetLine2,
        cityLine,
        address.province,
        address.country,
        address.phoneNumber,
    ].filter(Boolean);
    return (
        <>
            {heading ? <Text style={{ ...label, margin: '0 0 6px' }}>{heading}</Text> : null}
            <Text style={{ margin: 0, fontSize: '14px', lineHeight: '22px', color: emailTheme.text }}>
                {address.fullName ? (
                    <>
                        <span style={{ fontWeight: 600, color: emailTheme.heading }}>{address.fullName}</span>
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
    padding: '12px 0',
    borderBottom: `1px solid ${emailTheme.border}`,
    fontSize: '14px',
    lineHeight: '20px',
    color: emailTheme.text,
    verticalAlign: 'middle',
};
const amountCell: CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap', color: emailTheme.heading };
const totalsCell: CSSProperties = { padding: '4px 0', fontSize: '14px', lineHeight: '22px', color: emailTheme.text };
const totalsAmount: CSSProperties = { ...totalsCell, textAlign: 'right', whiteSpace: 'nowrap' };

function LineImage({ src, alt }: { src?: string | null; alt: string }) {
    if (!src) {
        return (
            <div
                style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '8px',
                    backgroundColor: emailTheme.pageBackground,
                    border: `1px solid ${emailTheme.border}`,
                }}
            />
        );
    }
    return (
        <Img
            src={withPreset(src, 112)}
            alt={alt}
            width="56"
            height="56"
            style={{
                borderRadius: '8px',
                border: `1px solid ${emailTheme.border}`,
                objectFit: 'cover',
                display: 'block',
            }}
        />
    );
}

function LineName({ name, quantity }: { name: string; quantity: number }) {
    return (
        <>
            <span style={{ fontWeight: 600, color: emailTheme.heading }}>{name}</span>
            <br />
            <span style={{ fontSize: '13px', color: emailTheme.muted }}>{`Qty ${quantity}`}</span>
        </>
    );
}

/**
 * @description
 * The order lines with images, then the sub-total, discounts, shipping and total.
 *
 * @docsCategory core plugins/Email
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
        <>
            <table
                className={EMAIL_DATA_TABLE_CLASS}
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                role="presentation"
                style={{ borderCollapse: 'collapse', borderTop: `1px solid ${emailTheme.border}` }}
            >
                <tbody>
                    {order.lines.map((line, i) => (
                        <tr key={`line-${i}`}>
                            <td style={{ ...cell, width: '72px' }}>
                                <LineImage src={line.featuredAsset?.preview} alt={line.productVariant.name} />
                            </td>
                            <td style={cell}>
                                <LineName name={line.productVariant.name} quantity={line.quantity} />
                            </td>
                            <td style={amountCell}>
                                <Money value={line.discountedLinePriceWithTax} currencyCode={currencyCode} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <table
                className={EMAIL_DATA_TABLE_CLASS}
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                role="presentation"
                style={{ borderCollapse: 'collapse', marginTop: '12px' }}
            >
                <tbody>
                    <tr>
                        <td style={totalsCell}>Subtotal</td>
                        <td style={totalsAmount}>
                            <Money value={order.subTotalWithTax} currencyCode={currencyCode} />
                        </td>
                    </tr>
                    {(order.discounts ?? []).map((discount, i) => (
                        <tr key={`discount-${i}`}>
                            <td style={totalsCell}>{discount.description}</td>
                            <td style={totalsAmount}>
                                <Money value={discount.amountWithTax} currencyCode={currencyCode} />
                            </td>
                        </tr>
                    ))}
                    {shippingLines.map((shippingLine, i) => (
                        <tr key={`shipping-${i}`}>
                            <td style={totalsCell}>
                                {shippingLine.shippingMethod ? `Shipping (${shippingLine.shippingMethod.name})` : 'Shipping'}
                            </td>
                            <td style={totalsAmount}>
                                <Money value={shippingLine.priceWithTax} currencyCode={currencyCode} />
                            </td>
                        </tr>
                    ))}
                    <tr>
                        <td
                            style={{
                                ...totalsCell,
                                paddingTop: '12px',
                                borderTop: `1px solid ${emailTheme.border}`,
                                fontSize: '16px',
                                fontWeight: 600,
                                color: emailTheme.heading,
                            }}
                        >
                            Total
                        </td>
                        <td
                            style={{
                                ...totalsAmount,
                                paddingTop: '12px',
                                borderTop: `1px solid ${emailTheme.border}`,
                                fontSize: '16px',
                                fontWeight: 600,
                                color: emailTheme.heading,
                            }}
                        >
                            <Money value={order.totalWithTax} currencyCode={currencyCode} />
                        </td>
                    </tr>
                </tbody>
            </table>
        </>
    );
}

export interface EmailFulfillment {
    method: string;
    trackingCode?: string | null;
    lines: Array<{ quantity: number; productVariant: { name: string }; featuredAsset?: { preview: string } | null }>;
}

/**
 * @description
 * The items in one fulfillment (shipment), with the shipping method and tracking code.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function FulfillmentSummary({ fulfillment }: { fulfillment: EmailFulfillment }) {
    return (
        <>
            <Row style={{ marginBottom: '16px' }}>
                <Column style={{ width: '50%', verticalAlign: 'top' }}>
                    <Text style={label}>Shipping method</Text>
                    <Text style={value}>{fulfillment.method}</Text>
                </Column>
                {fulfillment.trackingCode ? (
                    <Column style={{ width: '50%', verticalAlign: 'top' }}>
                        <Text style={label}>Tracking number</Text>
                        <Text style={{ ...value, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            {fulfillment.trackingCode}
                        </Text>
                    </Column>
                ) : null}
            </Row>
            <table
                className={EMAIL_DATA_TABLE_CLASS}
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                role="presentation"
                style={{ borderCollapse: 'collapse', borderTop: `1px solid ${emailTheme.border}` }}
            >
                <tbody>
                    {fulfillment.lines.map((line, i) => (
                        <tr key={i}>
                            <td style={{ ...cell, width: '72px' }}>
                                <LineImage src={line.featuredAsset?.preview} alt={line.productVariant.name} />
                            </td>
                            <td style={cell}>
                                <LineName name={line.productVariant.name} quantity={line.quantity} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
}

function withPreset(url: string, size: number) {
    return `${url}${url.includes('?') ? '&' : '?'}w=${size}&h=${size}&mode=crop`;
}
