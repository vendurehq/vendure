import { render, toPlainText } from '@react-email/render';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { createElement } from 'react';

import { EMAIL_DATA_TABLE_CLASS } from '../components/order-blocks';
import { EmailRenderReactContext } from '../template/email-context';
import { EmailTemplateSource } from '../template/email-template';
import { interpolateTemplateString } from '../template/interpolate';

import { EmailGenerator, EmailGeneratorInput, EmailGeneratorResult } from './email-generator';

/**
 * @description
 * Renders React email templates (see {@link defineEmailTemplate}) to HTML using
 * [React Email](https://react.email/), and derives a plain text version from the HTML.
 *
 * The subject and "from" fields may contain `{{ path.to.var }}` placeholders, which are
 * replaced with the matching template variables.
 *
 * This is the default generator since v4.0.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailGenerator
 * @since 4.0.0
 */
export class ReactEmailGenerator implements EmailGenerator {
    canGenerate(template: EmailTemplateSource): boolean {
        return template.kind === 'react';
    }

    async generate(input: EmailGeneratorInput): Promise<EmailGeneratorResult> {
        const { template, templateVars, type, languageCode, channelCode } = input;
        if (template.kind !== 'react') {
            throw new Error(`ReactEmailGenerator cannot render templates of kind "${template.kind}"`);
        }
        const element = createElement(
            EmailRenderReactContext.Provider,
            { value: { type, languageCode: languageCode as LanguageCode, channelCode } },
            createElement(template.component, templateVars),
        );
        const body = await render(element);
        return {
            from: interpolateTemplateString(input.from, templateVars),
            subject: interpolateTemplateString(input.subject, templateVars),
            body,
            text: toPlainText(body, {
                selectors: [
                    {
                        selector: `table.${EMAIL_DATA_TABLE_CLASS}`,
                        format: 'dataTable',
                        options: { maxColumnWidth: 60 },
                    },
                ],
            }),
        };
    }
}
