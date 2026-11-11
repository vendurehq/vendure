import type { ReactNode } from 'react';

/**
 * @description
 * Everything the recipient sees: the subject line, the HTML body and, optionally, a hand-written
 * plain-text version. When `text` is not set, the plain text is derived from the HTML.
 *
 * The props are the email's data (the return value of the definition's `data()`) merged with the
 * global template variables. They pass through the job queue, so they are plain JSON: dates are ISO
 * strings, and getters and methods of entity classes are gone.
 *
 * Create one with {@link defineEmailTemplate}.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
export interface EmailTemplate<Props = any> {
    /**
     * @description
     * The subject line. A string may contain `{{ path.to.var }}` placeholders.
     */
    subject: string | ((props: Props) => string);
    /**
     * @description
     * The HTML body, as a React component built from the email components.
     */
    body: (props: Props) => ReactNode;
    /**
     * @description
     * A hand-written plain-text body. Derived from the HTML when not set.
     */
    text?: (props: Props) => string;
}

/**
 * @description
 * Defines an email template. Give it the props type, usually the template's own props interface.
 *
 * @example
 * ```tsx
 * export const WelcomeTemplate = defineEmailTemplate<{ firstName: string; branding?: EmailBranding }>({
 *     subject: ({ firstName }) => `Welcome, ${firstName}`,
 *     body: ({ firstName, branding }) => (
 *         <EmailLayout title="Welcome" branding={branding}>
 *             <EmailSection>
 *                 <EmailText>Hi {firstName}, welcome aboard!</EmailText>
 *             </EmailSection>
 *         </EmailLayout>
 *     ),
 * });
 * ```
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
export function defineEmailTemplate<Props = any>(template: EmailTemplate<Props>): EmailTemplate<Props> {
    return template;
}

const packageDefaults = new WeakSet<EmailTemplate<any>>();

/** @internal Marks a template that ships with `@vendure/email`, so tooling can report it as such. */
export function markPackageDefault<T extends EmailTemplate<any>>(template: T): T {
    packageDefaults.add(template);
    return template;
}

/** @internal */
export function isPackageDefault(template: EmailTemplate<any>): boolean {
    return packageDefaults.has(template);
}
