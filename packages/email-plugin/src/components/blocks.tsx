import { Body } from '@react-email/body';
import { Button } from '@react-email/button';
import { Container } from '@react-email/container';
import { Head } from '@react-email/head';
import { Heading } from '@react-email/heading';
import { Html } from '@react-email/html';
import { Img } from '@react-email/img';
import { Preview } from '@react-email/preview';
import { Section } from '@react-email/section';
import { Text } from '@react-email/text';
import type { CSSProperties, ReactNode } from 'react';

import { EmailBranding, EmailBrandingContext, useEmailBranding, useOptionalEmailContext } from './branding';
import { formatDate, formatMoney } from './formatting';

const fontFamily = 'Helvetica, Arial, sans-serif';

/**
 * @description
 * Props of the {@link EmailLayout} component.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export interface EmailLayoutProps {
    /**
     * @description
     * The document title.
     */
    title: string;
    /**
     * @description
     * The preview text shown by most email clients next to the subject line.
     */
    preview?: string;
    branding?: EmailBranding;
    children?: ReactNode;
}

/**
 * @description
 * The outer frame of an email: the document head, a header with the shop logo or name, the content
 * column and a footer. The given {@link EmailBranding} is made available to the components inside it.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailLayout({ title, preview, branding = {}, children }: EmailLayoutProps) {
    const languageCode = useOptionalEmailContext()?.languageCode;
    return (
        <EmailBrandingContext.Provider value={branding}>
            <Html lang={languageCode?.replace(/_/g, '-')}>
                <Head>
                    <title>{title}</title>
                </Head>
                {preview ? <Preview>{preview}</Preview> : null}
                <Body style={{ backgroundColor: '#f0f0f0', margin: 0, padding: '24px 0', fontFamily }}>
                    <Container style={{ maxWidth: '600px', backgroundColor: '#ffffff' }}>
                        <EmailHeader />
                        {children}
                        <EmailFooter />
                    </Container>
                </Body>
            </Html>
        </EmailBrandingContext.Provider>
    );
}

/**
 * @description
 * Shows the shop logo, or else the shop name, from the {@link EmailBranding}. Renders nothing if
 * neither is set.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailHeader() {
    const { logoUrl, name } = useEmailBranding();
    if (!logoUrl && !name) {
        return null;
    }
    return (
        <Section style={{ padding: '24px 32px', borderBottom: '1px solid #eeeeee' }}>
            {logoUrl ? (
                <Img src={logoUrl} alt={name ?? ''} height="40" style={{ height: '40px', width: 'auto' }} />
            ) : (
                <Text style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#333333' }}>
                    {name}
                </Text>
            )}
        </Section>
    );
}

/**
 * @description
 * Shows the `footerText` from the {@link EmailBranding}. Renders nothing if it is not set.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailFooter() {
    const { footerText, primaryColor, primaryTextColor } = useEmailBranding();
    if (!footerText) {
        return null;
    }
    return (
        <Section style={{ backgroundColor: primaryColor, padding: '16px 32px' }}>
            <Text style={{ margin: 0, fontSize: '12px', textAlign: 'center', color: primaryTextColor }}>
                {footerText}
            </Text>
        </Section>
    );
}

/**
 * @description
 * A content section of an email. The `'muted'` variant has a light grey background, and the
 * `'highlight'` variant uses the primary brand color.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailSection({
    variant = 'default',
    children,
}: {
    variant?: 'default' | 'muted' | 'highlight';
    children?: ReactNode;
}) {
    const { primaryColor, primaryTextColor } = useEmailBranding();
    const style: CSSProperties = { padding: '16px 32px' };
    if (variant === 'muted') {
        style.backgroundColor = '#f7f7f7';
    }
    if (variant === 'highlight') {
        style.backgroundColor = primaryColor;
        style.color = primaryTextColor;
    }
    return <Section style={style}>{children}</Section>;
}

/**
 * @description
 * A paragraph of body text.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailText({ children }: { children?: ReactNode }) {
    return <Text style={{ fontSize: '15px', lineHeight: '24px', color: '#525252' }}>{children}</Text>;
}

/**
 * @description
 * A heading.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailHeading({ children }: { children?: ReactNode }) {
    return (
        <Heading
            as="h2"
            style={{ fontSize: '18px', fontWeight: 'normal', color: '#555555', margin: '16px 0 8px' }}
        >
            {children}
        </Heading>
    );
}

/**
 * @description
 * A call-to-action button in the primary brand color.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailButton({ href, children }: { href: string; children?: ReactNode }) {
    const { primaryColor, primaryTextColor } = useEmailBranding();
    return (
        <Section style={{ padding: '8px 0 16px' }}>
            <Button
                href={href}
                style={{
                    backgroundColor: primaryColor,
                    color: primaryTextColor,
                    padding: '12px 24px',
                    borderRadius: '4px',
                    fontSize: '15px',
                    fontWeight: 'bold',
                    textDecoration: 'none',
                }}
            >
                {children}
            </Button>
        </Section>
    );
}

/**
 * @description
 * Formats an amount of money in the language of the email. See {@link formatMoney}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function Money({ value, currencyCode }: { value: number; currencyCode?: string | null }) {
    const languageCode = useOptionalEmailContext()?.languageCode;
    return <>{formatMoney(value, currencyCode, languageCode)}</>;
}

/**
 * @description
 * Formats a date in the language of the email. Accepts a `Date` or an ISO date string.
 * See {@link formatDate}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email components
 * @since 4.0.0
 */
export function FormattedDate({
    value,
    options,
}: {
    value: Date | string | null | undefined;
    options?: Intl.DateTimeFormatOptions;
}) {
    const languageCode = useOptionalEmailContext()?.languageCode;
    if (value == null) {
        return null;
    }
    return <>{formatDate(value, languageCode, options)}</>;
}
