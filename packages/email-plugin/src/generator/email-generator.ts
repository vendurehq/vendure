import { InjectableStrategy, VendureEvent } from '@vendure/core';

import { EmailDetails, EmailPluginOptions } from '../types';

type EmailGeneratorResult = Pick<EmailDetails, 'from' | 'subject' | 'body'>;

/**
 * @description
 * An EmailGenerator generates the subject and body details of an email.
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
    onInit?(options: EmailPluginOptions): void | Promise<void>;

    /**
     * @description
     * Given a subject and body from an email template, this method generates the final
     * interpolated email text.
     */
    generate(
        from: string,
        subject: string,
        body: string,
        templateVars: { [key: string]: any },
    ): EmailGeneratorResult | Promise<EmailGeneratorResult>;
}
