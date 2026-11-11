import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Injector, RequestContext } from '@vendure/core';

import { EmailTemplate } from './email-template';

/**
 * @description
 * The input of {@link EmailTemplateLoader}.`load()`.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
export interface LoadEmailTemplateInput {
    type: string;
    languageCode: LanguageCode;
    channelCode: string;
}

/**
 * @description
 * Supplies a template that overrides the template of an email definition, e.g. one stored in the
 * database per channel and language. Return `undefined` to pass to the next loader, and finally to
 * the definition's own template.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
export interface EmailTemplateLoader {
    /**
     * @description
     * A short name shown by the dev tooling when this loader supplies a template, e.g. `'database'`.
     */
    readonly name?: string;
    load(
        injector: Injector,
        ctx: RequestContext,
        input: LoadEmailTemplateInput,
    ): EmailTemplate | undefined | Promise<EmailTemplate | undefined>;
}
