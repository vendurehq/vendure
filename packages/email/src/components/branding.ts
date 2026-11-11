import { createContext, useContext } from 'react';

import { EmailRenderReactContext } from '../template/email-context';

/**
 * @description
 * Brand settings used by the default email templates and the email components. All fields are
 * optional and JSON-serializable, so they can be set as a global template variable and stored
 * or edited as data.
 *
 * The default templates read them from the `branding` template variable:
 *
 * @example
 * ```ts
 * EmailPlugin.init({
 *     // ...
 *     defaultFrom: '"My Shop" <noreply@myshop.com>',
 *     globalTemplateVars: {
 *         branding: {
 *             name: 'My Shop',
 *             logoUrl: 'https://myshop.com/logo.png',
 *             primaryColor: '#0b7285',
 *             footerText: 'My Shop Ltd, 1 High Street, London',
 *         },
 *     },
 * });
 * ```
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export interface EmailBranding {
    /**
     * @description
     * The shop name, shown in the header when there is no logo, and as the logo's alt text.
     */
    name?: string;
    logoUrl?: string;
    /**
     * @description
     * Used for buttons and highlighted sections.
     *
     * @default '#18181b'
     */
    primaryColor?: string;
    /**
     * @description
     * The text color used on top of the primary color.
     *
     * @default '#ffffff'
     */
    primaryTextColor?: string;
    /**
     * @description
     * Shown in the footer of every email, e.g. the company address.
     */
    footerText?: string;
}

/** @internal */
export const defaultBranding: Required<Pick<EmailBranding, 'primaryColor' | 'primaryTextColor'>> = {
    primaryColor: '#18181b',
    primaryTextColor: '#ffffff',
};

/** @internal */
export const EmailBrandingContext = createContext<EmailBranding>({});

/**
 * @description
 * Returns the {@link EmailBranding} given to the enclosing {@link EmailLayout}, merged with defaults.
 *
 * @docsCategory core plugins/Email
 * @docsPage Email components
 * @since 4.0.0
 */
export function useEmailBranding(): EmailBranding & typeof defaultBranding {
    return { ...defaultBranding, ...stripUndefined(useContext(EmailBrandingContext)) };
}

/**
 * Like {@link useEmailContext}, but returns `undefined` outside of an EmailPlugin render, so that
 * components can also be rendered on their own, e.g. in an editor canvas or a unit test.
 *
 * @internal
 */
export function useOptionalEmailContext() {
    return useContext(EmailRenderReactContext);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v != null)) as Partial<T>;
}
