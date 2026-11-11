import { Body } from '@react-email/body';
import { Button } from '@react-email/button';
import { Container } from '@react-email/container';
import { Head } from '@react-email/head';
import { Heading } from '@react-email/heading';
import { Hr } from '@react-email/hr';
import { Html } from '@react-email/html';
import { Img } from '@react-email/img';
import { Link } from '@react-email/link';
import { Preview } from '@react-email/preview';
import { Section } from '@react-email/section';
import { Text } from '@react-email/text';
import type { CSSProperties, ReactNode } from 'react';

import { EmailBranding, EmailBrandingContext, useEmailBranding, useOptionalEmailContext } from './branding';
import { useEmailDesign } from './design';
import { formatDate, formatMoney } from './formatting';

/*
 * Design tokens of the default emails. Email clients only support inline styles, so the components
 * apply these directly. Keep to a neutral palette: the brand colour from `branding` is used for
 * buttons and links only, so any brand colour works.
 */
export const emailTheme = {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    pageBackground: '#f4f4f5',
    cardBackground: '#ffffff',
    subtleBackground: '#fafafa',
    border: '#e4e4e7',
    text: '#3f3f46',
    heading: '#09090b',
    muted: '#71717a',
    radius: '12px',
    buttonRadius: '8px',
    gutter: '32px',
    logoHeight: 32,
    headerAlign: 'left' as 'left' | 'center',
};

/**
 * @description
 * The design tokens for the email being rendered: {@link emailTheme} with the design set in the
 * Dashboard applied. Use it in custom components so they follow that design.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function useEmailTheme(): typeof emailTheme {
    const design = useEmailDesign();
    const px = (value: number | undefined, fallback: string) => (value == null ? fallback : `${value}px`);
    return {
        ...emailTheme,
        fontFamily: design.fontFamily || emailTheme.fontFamily,
        pageBackground: design.pageBackground || emailTheme.pageBackground,
        cardBackground: design.cardBackground || emailTheme.cardBackground,
        radius: px(design.cardRadius, emailTheme.radius),
        buttonRadius: px(design.buttonRadius, emailTheme.buttonRadius),
        logoHeight: design.logoHeight ?? emailTheme.logoHeight,
        headerAlign: design.headerAlign ?? emailTheme.headerAlign,
    };
}

/**
 * @description
 * Props of {@link EmailLayout}.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export interface EmailLayoutProps {
    /** The document title. Some clients show it. */
    title: string;
    /** The preview text shown next to the subject in the inbox. */
    preview?: string;
    branding?: EmailBranding;
    children?: ReactNode;
}

/**
 * @description
 * The root of every email: a white card on a light background, with the shop name or logo above it
 * and the footer text below it. Put {@link EmailSection}s inside it.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailLayout({ title, preview, branding = {}, children }: Readonly<EmailLayoutProps>) {
    const languageCode = useOptionalEmailContext()?.languageCode;
    const theme = useEmailTheme();
    return (
        <EmailBrandingContext.Provider value={branding}>
            <Html lang={languageCode?.replace(/_/g, '-')}>
                <Head>
                    <title>{title}</title>
                    <meta name="color-scheme" content="light" />
                    <meta name="supported-color-schemes" content="light" />
                </Head>
                {preview ? <Preview>{preview}</Preview> : null}
                <Body
                    style={{
                        backgroundColor: theme.pageBackground,
                        margin: 0,
                        padding: '32px 12px',
                        fontFamily: theme.fontFamily,
                        WebkitFontSmoothing: 'antialiased',
                    }}
                >
                    <Container style={{ maxWidth: '560px', width: '100%' }}>
                        <EmailHeader />
                        <Section
                            style={{
                                backgroundColor: theme.cardBackground,
                                border: `1px solid ${theme.border}`,
                                borderRadius: theme.radius,
                                padding: `8px 0 ${theme.gutter}`,
                            }}
                        >
                            {children}
                        </Section>
                        <EmailFooter />
                    </Container>
                </Body>
            </Html>
        </EmailBrandingContext.Provider>
    );
}

/**
 * @description
 * The logo, or the shop name when there is no logo, above the card. Rendered by {@link EmailLayout}.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailHeader() {
    const { logoUrl, name } = useEmailBranding();
    const theme = useEmailTheme();
    if (!logoUrl && !name) {
        return <Section style={{ height: '8px' }} />;
    }
    return (
        <Section style={{ padding: '0 8px 20px', textAlign: theme.headerAlign }}>
            {logoUrl ? (
                <Img
                    src={logoUrl}
                    alt={name ?? ''}
                    height={String(theme.logoHeight)}
                    style={{
                        height: `${theme.logoHeight}px`,
                        width: 'auto',
                        display: 'inline-block',
                    }}
                />
            ) : (
                <Text
                    style={{
                        margin: 0,
                        fontSize: '18px',
                        lineHeight: '28px',
                        fontWeight: 600,
                        letterSpacing: '-0.01em',
                        color: emailTheme.heading,
                    }}
                >
                    {name}
                </Text>
            )}
        </Section>
    );
}

/**
 * @description
 * The footer text from `branding`, below the card. Rendered by {@link EmailLayout}.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailFooter() {
    const { footerText } = useEmailBranding();
    if (!footerText) {
        return null;
    }
    return (
        <Section style={{ padding: '20px 8px 0' }}>
            <Text style={{ margin: 0, fontSize: '12px', lineHeight: '18px', color: emailTheme.muted }}>
                {footerText}
            </Text>
        </Section>
    );
}

/**
 * @description
 * A horizontal band of the card. `muted` gives it a light grey box, for example for an address.
 * `highlight` is kept for compatibility and looks the same as `muted`.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailSection({
    variant = 'default',
    children,
}: Readonly<{
    variant?: 'default' | 'muted' | 'highlight';
    children?: ReactNode;
}>) {
    if (variant === 'default') {
        return <Section style={{ padding: `0 ${emailTheme.gutter}` }}>{children}</Section>;
    }
    return (
        <Section style={{ padding: `8px ${emailTheme.gutter}` }}>
            <Section
                style={{
                    backgroundColor: emailTheme.subtleBackground,
                    border: `1px solid ${emailTheme.border}`,
                    borderRadius: '8px',
                    padding: '16px 20px',
                }}
            >
                {children}
            </Section>
        </Section>
    );
}

/**
 * @description
 * The main heading of an email, e.g. "Your order is on its way". Use one, at the top of the card.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailTitle({ children }: Readonly<{ children?: ReactNode }>) {
    return (
        <Heading
            as="h1"
            style={{
                margin: '24px 0 12px',
                fontSize: '24px',
                lineHeight: '32px',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: emailTheme.heading,
            }}
        >
            {children}
        </Heading>
    );
}

/**
 * @description
 * A paragraph of body text.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailText({ children, style }: Readonly<{ children?: ReactNode; style?: CSSProperties }>) {
    return (
        <Text
            style={{
                margin: '0 0 16px',
                fontSize: '15px',
                lineHeight: '24px',
                color: emailTheme.text,
                // Keeps the line breaks of multi-line content slots.
                whiteSpace: 'pre-line',
                ...style,
            }}
        >
            {children}
        </Text>
    );
}

/**
 * @description
 * Small grey text, for notes such as "If you didn't request this, ignore this email."
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailMutedText({ children }: Readonly<{ children?: ReactNode }>) {
    return (
        <Text style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: '20px', color: emailTheme.muted }}>
            {children}
        </Text>
    );
}

/**
 * @description
 * The heading of a part of the email, e.g. "Order summary".
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailHeading({ children }: Readonly<{ children?: ReactNode }>) {
    return (
        <Heading
            as="h2"
            style={{
                margin: '28px 0 12px',
                fontSize: '13px',
                lineHeight: '20px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: emailTheme.muted,
            }}
        >
            {children}
        </Heading>
    );
}

/**
 * @description
 * A thin horizontal line.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailDivider() {
    return <Hr style={{ border: 'none', borderTop: `1px solid ${emailTheme.border}`, margin: '24px 0' }} />;
}

/**
 * @description
 * A call-to-action button in the brand colour. When `fallbackLink` is set, the URL is also shown as
 * text below the button, for clients that block buttons.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function EmailButton({
    href,
    children,
    fallbackLink,
}: Readonly<{
    href: string;
    children?: ReactNode;
    fallbackLink?: boolean;
}>) {
    const { primaryColor, primaryTextColor } = useEmailBranding();
    const theme = useEmailTheme();
    return (
        <Section style={{ padding: '8px 0 16px' }}>
            <Button
                href={href}
                style={{
                    backgroundColor: primaryColor,
                    color: primaryTextColor,
                    padding: '12px 20px',
                    borderRadius: theme.buttonRadius,
                    fontSize: '15px',
                    lineHeight: '20px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    display: 'inline-block',
                }}
            >
                {children}
            </Button>
            {fallbackLink ? (
                <Text
                    style={{
                        margin: '16px 0 0',
                        fontSize: '13px',
                        lineHeight: '20px',
                        color: emailTheme.muted,
                    }}
                >
                    Or open this link:{' '}
                    <Link href={href} style={{ color: primaryColor, wordBreak: 'break-all' }}>
                        {href}
                    </Link>
                </Text>
            ) : null}
        </Section>
    );
}

/**
 * @description
 * A money amount, in minor units, formatted in the email's language.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function Money({ value, currencyCode }: Readonly<{ value: number; currencyCode?: string | null }>) {
    const languageCode = useOptionalEmailContext()?.languageCode;
    return <>{formatMoney(value, currencyCode, languageCode)}</>;
}

/**
 * @description
 * A date, formatted in the email's language.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function FormattedDate({
    value,
    options,
}: Readonly<{
    value: Date | string | null | undefined;
    options?: Intl.DateTimeFormatOptions;
}>) {
    const languageCode = useOptionalEmailContext()?.languageCode;
    if (value == null) {
        return null;
    }
    return <>{formatDate(value, languageCode, options)}</>;
}
