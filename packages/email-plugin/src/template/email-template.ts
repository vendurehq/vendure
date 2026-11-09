import type { ComponentType } from 'react';

/**
 * @description
 * An email template defined as a React component, rendered by the {@link ReactEmailGenerator}
 * using [React Email](https://react.email/).
 *
 * The component receives the email's template variables as its props. Note that the template
 * variables are serialized to JSON when the email job is placed on the job queue, so the props
 * are plain JSON data: `Date` values arrive as ISO strings, and getters and methods of entity
 * classes are not available.
 *
 * Create one with {@link defineEmailTemplate}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export interface ReactEmailTemplate<Props = any> {
    kind: 'react';
    component: ComponentType<Props>;
    /**
     * @description
     * Overrides the subject set on the {@link EmailEventHandler}. May contain `{{ path.to.var }}`
     * placeholders, which are replaced with the matching template variables.
     */
    subject?: string;
    /**
     * @description
     * Overrides the "from" address set on the {@link EmailEventHandler}. May contain
     * `{{ path.to.var }}` placeholders.
     */
    from?: string;
}

/**
 * @description
 * An email template whose body is a string, such as a Handlebars/MJML template rendered by
 * the {@link HandlebarsMjmlGenerator}.
 *
 * A {@link TemplateLoader} which returns a plain string is treated as returning a
 * `StringEmailTemplate`.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export interface StringEmailTemplate {
    kind: 'string';
    body: string;
    /**
     * @description
     * Overrides the subject set on the {@link EmailEventHandler}.
     */
    subject?: string;
    /**
     * @description
     * Overrides the "from" address set on the {@link EmailEventHandler}.
     */
    from?: string;
}

/**
 * @description
 * A resolved email template, ready to be passed to an {@link EmailGenerator}. Each kind is
 * rendered by the generator whose `canGenerate()` method accepts it, so templates of
 * different kinds can be used side by side (for example while migrating from Handlebars/MJML
 * templates to React templates one at a time).
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export type EmailTemplateSource = ReactEmailTemplate | StringEmailTemplate;

/**
 * @description
 * Defines an email template as a React component. Use the
 * [React Email components](https://react.email/docs/components/html) or Vendure's own email
 * blocks to build the markup.
 *
 * @example
 * ```tsx
 * import { defineEmailTemplate, EmailLayout } from '\@vendure/email-plugin';
 * import { Text } from '\@react-email/text';
 *
 * export const WelcomeEmail = defineEmailTemplate<{ firstName: string }>(({ firstName }) => (
 *     <EmailLayout title="Welcome">
 *         <Text>Hi {firstName}, welcome aboard!</Text>
 *     </EmailLayout>
 * ));
 *
 * // In vendure-config.ts
 * const welcomeHandler = new EmailEventListener('welcome')
 *     .on(AccountVerifiedEvent)
 *     .setRecipient(event => event.customer.emailAddress)
 *     .setFrom('{{ fromAddress }}')
 *     .setSubject('Welcome to our store')
 *     .setTemplateVars(event => ({ firstName: event.customer.firstName }))
 *     .setTemplate(WelcomeEmail);
 * ```
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailTemplate
 * @since 4.0.0
 */
export function defineEmailTemplate<Props = any>(
    component: ComponentType<Props>,
    options: { subject?: string; from?: string } = {},
): ReactEmailTemplate<Props> {
    return { kind: 'react', component, ...options };
}

/**
 * Normalizes the value returned by a {@link TemplateLoader}.
 */
export function toEmailTemplateSource(
    value: EmailTemplateSource | string | undefined | null,
): EmailTemplateSource | undefined {
    if (value == null) {
        return undefined;
    }
    if (typeof value === 'string') {
        return { kind: 'string', body: value };
    }
    return value;
}
