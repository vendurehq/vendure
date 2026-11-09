import { Logger } from '@vendure/core';
import dateFormat from 'dateformat';

import { loggerCtx } from '../constants';
import { EmailTemplateSource } from '../template/email-template';
import { InitializedEmailPluginOptions } from '../types';

import { EmailGenerator, EmailGeneratorInput } from './email-generator';

/**
 * @description
 * Uses Handlebars (https://handlebarsjs.com/) to output MJML (https://mjml.io) which is then
 * compiled down to responsive email HTML. Renders string templates, such as those loaded by the
 * {@link FileBasedTemplateLoader}.
 *
 * Since v4.0, `handlebars` and `mjml` are optional peer dependencies of the EmailPlugin. To keep
 * using Handlebars/MJML templates, install them in your project:
 *
 * ```
 * npm install handlebars mjml
 * ```
 *
 * @deprecated Use React templates rendered by the {@link ReactEmailGenerator} instead. See the
 * migration guide in the EmailPlugin docs. This generator will be removed in a future version.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailGenerator
 */
export class HandlebarsMjmlGenerator implements EmailGenerator {
    private handlebars: any;
    private mjml2html: any;
    private loadError: Error | undefined;
    private deprecationWarned = false;

    async onInit(options: InitializedEmailPluginOptions) {
        try {
            this.handlebars = (await import('handlebars')).default;
            this.mjml2html = (await import('mjml')).default;
        } catch (e: any) {
            // handlebars and mjml are optional peer dependencies. If they are not installed,
            // this generator stays inactive and only throws if a string template needs rendering.
            this.loadError = e;
            return;
        }
        for (const loader of options.templateLoaders) {
            if (loader.loadPartials) {
                const partials = await loader.loadPartials();
                partials.forEach(({ name, content }) => this.handlebars.registerPartial(name, content));
            }
        }
        this.registerHelpers();
    }

    canGenerate(template: EmailTemplateSource): boolean {
        return template.kind === 'string';
    }

    async generate({ type, from, subject, template, templateVars }: EmailGeneratorInput) {
        if (template.kind !== 'string') {
            throw new Error(`HandlebarsMjmlGenerator cannot render templates of kind "${template.kind}"`);
        }
        if (!this.handlebars || !this.mjml2html) {
            throw new Error(
                'This email uses a Handlebars/MJML string template, but the "handlebars" and "mjml" packages ' +
                    'could not be loaded. Install them (`npm install handlebars mjml`) or migrate the template ' +
                    `to a React template. (${this.loadError?.message ?? 'not initialized'})`,
            );
        }
        if (!this.deprecationWarned) {
            this.deprecationWarned = true;
            Logger.warn(
                `The "${type}" email uses a Handlebars/MJML template. These are deprecated and will be removed ` +
                    'in a future version. See the EmailPlugin migration guide for moving to React templates.',
                loggerCtx,
            );
        }
        const Handlebars = this.handlebars;
        const compiledFrom = Handlebars.compile(from, { noEscape: true });
        const compiledSubject = Handlebars.compile(subject);
        const compiledTemplate = Handlebars.compile(template.body);
        // We enable prototype properties here, aware of the security implications
        // described here: https://handlebarsjs.com/api-reference/runtime-options.html#options-to-control-prototype-access
        // This is needed because some Vendure entities use getters on the entity
        // prototype (e.g. Order.total) which may need to be interpolated.
        const templateOptions = { allowProtoPropertiesByDefault: true };
        const fromResult = compiledFrom(templateVars, templateOptions);
        const subjectResult = compiledSubject(templateVars, templateOptions);
        const mjml = compiledTemplate(templateVars, templateOptions);
        const body = (await this.mjml2html(mjml)).html;
        return { from: fromResult, subject: subjectResult, body };
    }

    private registerHelpers() {
        this.handlebars.registerHelper('formatDate', (date: Date | undefined, format: string | object) => {
            if (!date) {
                return date;
            }
            if (typeof format !== 'string') {
                format = 'default';
            }
            return dateFormat(date, format);
        });

        this.handlebars.registerHelper(
            'formatMoney',
            (amount?: number, currencyCode?: string, locale?: string) => {
                if (amount == null) {
                    return amount;
                }
                // Last parameter is a generic "options" object which is not used here.
                // If it's supplied, it means the helper function did not receive the additional, optional parameters.
                // See https://handlebarsjs.com/api-reference/helpers.html#the-options-parameter
                if (!currencyCode || typeof currencyCode === 'object') {
                    return new Intl.NumberFormat(typeof locale === 'object' ? undefined : locale, {
                        style: 'decimal',
                    }).format(amount / 100);
                }
                // Same reasoning for `locale` as for `currencyCode` here.
                return new Intl.NumberFormat(typeof locale === 'object' ? undefined : locale, {
                    style: 'currency',
                    currency: currencyCode,
                }).format(amount / 100);
            },
        );
    }
}
