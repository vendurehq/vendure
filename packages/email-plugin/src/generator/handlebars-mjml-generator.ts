import { ConfigService, DEFAULT_MONEY_PRECISION, getMoneyPrecision, Injector } from '@vendure/core';
import dateFormat from 'dateformat';
import Handlebars from 'handlebars';
import mjml2html from 'mjml';

import { InitializedEmailPluginOptions } from '../types';

import { EmailGenerator } from './email-generator';

/**
 * @description
 * Uses Handlebars (https://handlebarsjs.com/) to output MJML (https://mjml.io) which is then
 * compiled down to responsive email HTML.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailGenerator
 */
export class HandlebarsMjmlGenerator implements EmailGenerator {
    private moneyPrecision = DEFAULT_MONEY_PRECISION;

    init(injector: Injector) {
        this.moneyPrecision = getMoneyPrecision(injector.get(ConfigService).entityOptions.moneyStrategy);
    }

    async onInit(options: InitializedEmailPluginOptions) {
        if (options.templateLoader.loadPartials) {
            const partials = await options.templateLoader.loadPartials();
            partials.forEach(({ name, content }) => Handlebars.registerPartial(name, content));
        }
        this.registerHelpers();
    }

    async generate(from: string, subject: string, template: string, templateVars: any) {
        const compiledFrom = Handlebars.compile(from, { noEscape: true });
        const compiledSubject = Handlebars.compile(subject);
        const compiledTemplate = Handlebars.compile(template);
        // We enable prototype properties here, aware of the security implications
        // described here: https://handlebarsjs.com/api-reference/runtime-options.html#options-to-control-prototype-access
        // This is needed because some Vendure entities use getters on the entity
        // prototype (e.g. Order.total) which may need to be interpolated.
        const templateOptions: RuntimeOptions = { allowProtoPropertiesByDefault: true };
        const fromResult = compiledFrom(templateVars, templateOptions);
        const subjectResult = compiledSubject(templateVars, templateOptions);
        const mjml = compiledTemplate(templateVars, templateOptions);
        const body = (await mjml2html(mjml)).html;
        return { from: fromResult, subject: subjectResult, body };
    }

    private registerHelpers() {
        Handlebars.registerHelper('formatDate', (date: Date | undefined, format: string | object) => {
            if (!date) {
                return date;
            }
            if (typeof format !== 'string') {
                format = 'default';
            }
            return dateFormat(date, format);
        });

        const precision = this.moneyPrecision;
        const factor = 10 ** precision;
        Handlebars.registerHelper(
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
                        maximumFractionDigits: precision,
                    }).format(amount / factor);
                }
                // Same reasoning for `locale` as for `currencyCode` here.
                // Show every decimal place of the configured precision, as the Dashboard does.
                return new Intl.NumberFormat(typeof locale === 'object' ? undefined : locale, {
                    style: 'currency',
                    currency: currencyCode,
                    minimumFractionDigits: precision,
                    maximumFractionDigits: precision,
                }).format(amount / factor);
            },
        );
    }
}
