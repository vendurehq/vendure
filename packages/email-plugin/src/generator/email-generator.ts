import { InjectableStrategy, RequestContext, VendureEvent } from '@vendure/core';

import { EmailTemplateSource } from '../template/email-template';
import { EmailDetails, InitializedEmailPluginOptions } from '../types';

/**
 * @description
 * The output of an {@link EmailGenerator}.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailGenerator
 * @since 4.0.0
 */
export type EmailGeneratorResult = Pick<EmailDetails, 'from' | 'subject' | 'body'> & {
    /**
     * @description
     * A plain text version of the body. Used when the {@link EmailEventHandler} does not
     * set one with `setPlainTextBody()`.
     */
    text?: string;
};

/**
 * @description
 * The input of an {@link EmailGenerator}'s `generate()` method.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailGenerator
 * @since 4.0.0
 */
export interface EmailGeneratorInput {
    ctx: RequestContext;
    /**
     * @description
     * The type of the email, as given to the {@link EmailEventListener}.
     */
    type: string;
    languageCode: string;
    channelCode: string;
    template: EmailTemplateSource;
    /**
     * @description
     * The "from" address before interpolation of template variables.
     */
    from: string;
    /**
     * @description
     * The subject before interpolation of template variables.
     */
    subject: string;
    templateVars: { [key: string]: any };
}

/**
 * @description
 * An EmailGenerator turns an {@link EmailTemplateSource} and its template variables into the
 * final subject, "from" address and body of an email.
 *
 * Several generators can be configured. For each email, the first generator whose
 * `canGenerate()` method returns `true` for the template is used. By default the
 * {@link ReactEmailGenerator} handles React templates and the deprecated
 * {@link HandlebarsMjmlGenerator} handles string templates.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailGenerator
 * @docsWeight 0
 */
export interface EmailGenerator<T extends string = any, E extends VendureEvent = any>
    extends InjectableStrategy {
    /**
     * @description
     * Any necessary setup can be performed here.
     */
    onInit?(options: InitializedEmailPluginOptions): void | Promise<void>;

    /**
     * @description
     * Returns `true` if this generator can render the given template.
     *
     * @since 4.0.0
     */
    canGenerate(template: EmailTemplateSource): boolean;

    /**
     * @description
     * Generates the final subject, "from" address and body of the email.
     */
    generate(input: EmailGeneratorInput): EmailGeneratorResult | Promise<EmailGeneratorResult>;
}
