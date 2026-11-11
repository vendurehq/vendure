import type { ReactNode } from 'react';

/**
 * @description
 * A piece of text in an email that admins can change in the Dashboard, per language and channel,
 * without touching the design. The template reads the resolved text with {@link useEmailContent}.
 *
 * The text may contain `{{ variableName }}` placeholders for the template's `variables`.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export interface EmailContentSlot {
    /** Shown next to the field in the Dashboard, e.g. "Introduction". */
    label: string;
    /** The text used when no override is stored. English. */
    default: string;
    /** Shows a multi-line field. Line breaks are kept in the email. */
    multiline?: boolean;
}

/**
 * @description
 * A value that the text of an email can include with `{{ name }}`. `value` turns the template props
 * into display text, e.g. a formatted amount, so that admins never see raw data.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export interface EmailVariable<Props = any> {
    /** Shown in the Dashboard, e.g. "Order code". */
    label: string;
    value: (
        props: Props,
        context: { languageCode: string; channelCode: string },
    ) => string | number | null | undefined;
}

/**
 * @description
 * Everything the recipient sees: the subject line, the HTML body and, optionally, a hand-written
 * plain-text version. When `text` is not set, the plain text is derived from the HTML.
 *
 * The props are the email's data (the return value of the definition's `data()`) merged with the
 * global template variables. They pass through the job queue, so they are plain JSON: dates are ISO
 * strings, and getters and methods of entity classes are gone.
 *
 * Text that admins should be able to change goes in `content`, and the values it may include go in
 * `variables`. A `subject` slot in `content` is used as the subject line.
 *
 * Create one with {@link defineEmailTemplate}.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export interface EmailTemplate<Props = any> {
    /**
     * @description
     * The subject line, when the template has no `subject` content slot. A string may contain
     * `{{ path.to.var }}` placeholders for the template props.
     */
    subject?: string | ((props: Props) => string);
    /**
     * @description
     * The editable text of the email, by slot name.
     */
    content?: Record<string, EmailContentSlot>;
    /**
     * @description
     * The values the editable text may include, by name.
     */
    variables?: Record<string, EmailVariable<Props>>;
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
 * export const WelcomeTemplate = defineEmailTemplate<{ customer: { firstName: string }; branding?: EmailBranding }>({
 *     content: {
 *         subject: { label: 'Subject', default: 'Welcome to {{ shopName }}' },
 *         title: { label: 'Title', default: 'Welcome, {{ firstName }}' },
 *         intro: { label: 'Introduction', default: 'Thanks for signing up.', multiline: true },
 *     },
 *     variables: {
 *         firstName: { label: 'First name', value: ({ customer }) => customer.firstName },
 *     },
 *     body: ({ branding }) => {
 *         const content = useEmailContent();
 *         return (
 *             <EmailLayout title={content.title} branding={branding}>
 *                 <EmailSection>
 *                     <EmailTitle>{content.title}</EmailTitle>
 *                     <EmailText>{content.intro}</EmailText>
 *                 </EmailSection>
 *             </EmailLayout>
 *         );
 *     },
 * });
 * ```
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export function defineEmailTemplate<Props = any>(template: EmailTemplate<Props>): EmailTemplate<Props> {
    if (template.subject === undefined && !template.content?.subject) {
        throw new Error('An email template needs a `subject`, or a `subject` slot in `content`');
    }
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
