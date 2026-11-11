import { LanguageCode } from '@vendure/common/lib/generated-types';
import { createContext, useContext } from 'react';

/**
 * @description
 * Information about the email being rendered, available to React email templates via
 * {@link useEmailContext}.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export interface EmailRenderContext {
    /**
     * @description
     * The type of the email, as set on its {@link EmailDefinition}, e.g. `'order-confirmation'`.
     */
    type: string;
    /**
     * @description
     * The language the email should be written in. Use this to translate the template's text.
     */
    languageCode: LanguageCode;
    /**
     * @description
     * The code of the Channel the email is being sent for.
     */
    channelCode: string;
}

/** @internal */
export const EmailRenderReactContext = createContext<EmailRenderContext | undefined>(undefined);

/**
 * @description
 * A React hook which returns the {@link EmailRenderContext} of the email being rendered. Use it
 * to translate a template or vary it by channel.
 *
 * @example
 * ```tsx
 * const strings = {
 *     en: { greeting: 'Thank you for your order!' },
 *     de: { greeting: 'Vielen Dank für Ihre Bestellung!' },
 * };
 *
 * function Greeting() {
 *     const { languageCode } = useEmailContext();
 *     const t = strings[languageCode] ?? strings.en;
 *     return <EmailText>{t.greeting}</EmailText>;
 * }
 *
 * export const OrderConfirmationTemplate = defineEmailTemplate<OrderConfirmationProps>({
 *     subject: ({ order }) => `Order confirmation for #${order.code}`,
 *     body: ({ order, branding }) => (
 *         <EmailLayout title="Order Receipt" branding={branding}>
 *             <Greeting />
 *         </EmailLayout>
 *     ),
 * });
 * ```
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export function useEmailContext(): EmailRenderContext {
    const value = useContext(EmailRenderReactContext);
    if (!value) {
        throw new Error(
            'useEmailContext() can only be used inside an email template rendered by the EmailPlugin',
        );
    }
    return value;
}
