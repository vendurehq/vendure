import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Injector, RequestContext } from '@vendure/core';

import { EMAIL_PLUGIN_OPTIONS } from './constants';
import { EmailGenerator } from './generator/email-generator';
import { EmailTemplateSource, toEmailTemplateSource } from './template/email-template';
import { InitializedEmailPluginOptions } from './types';

/**
 * @description
 * Where the template used to render an email came from.
 *
 * - `'override'`: passed directly to `render()`, e.g. an unsaved template being previewed.
 * - `'loader'`: returned by a configured {@link TemplateLoader}.
 * - `'handler'`: set on the {@link EmailEventHandler} with `setTemplate()`.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailRenderService
 * @since 4.0.0
 */
export type EmailTemplateOrigin = 'override' | 'loader' | 'handler';

/**
 * @description
 * The input of {@link EmailRenderService}.render().
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailRenderService
 * @since 4.0.0
 */
export interface RenderEmailInput {
    /**
     * @description
     * The email type, as given to the {@link EmailEventListener}.
     */
    type: string;
    /**
     * @description
     * The "from" address before interpolation.
     */
    from: string;
    /**
     * @description
     * The subject before interpolation.
     */
    subject: string;
    templateVars: { [key: string]: any };
    /**
     * @description
     * Defaults to the language of the RequestContext.
     */
    languageCode?: LanguageCode;
    /**
     * @description
     * Defaults to the Channel of the RequestContext.
     */
    channelCode?: string;
    /**
     * @description
     * The template file name passed to the {@link TemplateLoader}s.
     *
     * @default 'body.hbs'
     */
    templateFile?: string;
    /**
     * @description
     * Renders this template instead of resolving one. Useful for previewing a template before it is saved.
     */
    template?: EmailTemplateSource;
}

/**
 * @description
 * The output of {@link EmailRenderService}.render().
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailRenderService
 * @since 4.0.0
 */
export interface RenderedEmail {
    from: string;
    subject: string;
    /**
     * @description
     * The HTML body.
     */
    body: string;
    /**
     * @description
     * A plain text body derived from the template, if the generator produces one.
     */
    text?: string;
    templateOrigin: EmailTemplateOrigin;
    templateKind: EmailTemplateSource['kind'];
}

/**
 * @description
 * Renders emails without sending them. This is what the EmailPlugin uses to generate every email it
 * sends, and it can also be used to preview emails, e.g. in the dev mailbox, a dashboard view, or an
 * email template editor.
 *
 * The template for an email is resolved in this order:
 *
 * 1. The `template` passed to `render()`, if any.
 * 2. The first configured {@link TemplateLoader} which returns a template.
 * 3. The template set on the {@link EmailEventHandler} with `setTemplate()`.
 *
 * The template is then passed to the first configured {@link EmailGenerator} which can render it.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailRenderService
 * @docsWeight 0
 * @since 4.0.0
 */
@Injectable()
export class EmailRenderService {
    private initialized: Promise<void> | undefined;

    constructor(
        @Inject(EMAIL_PLUGIN_OPTIONS) private options: InitializedEmailPluginOptions,
        private moduleRef: ModuleRef,
    ) {}

    /** @internal */
    init(): Promise<void> {
        if (!this.initialized) {
            this.initialized = this.initGenerators();
        }
        return this.initialized;
    }

    /** @internal */
    async destroy() {
        for (const generator of this.options.emailGenerators) {
            if (typeof generator.destroy === 'function') {
                await generator.destroy();
            }
        }
    }

    /**
     * @description
     * Resolves the template for an email and renders it.
     */
    async render(ctx: RequestContext, input: RenderEmailInput): Promise<RenderedEmail> {
        await this.init();
        const languageCode = input.languageCode ?? ctx.languageCode;
        const channelCode = input.channelCode ?? ctx.channel?.code;
        const { template, origin } = input.template
            ? { template: input.template, origin: 'override' as const }
            : await this.resolveTemplate(ctx, { ...input, languageCode, channelCode });
        const generator = this.getGenerator(template);
        const result = await generator.generate({
            ctx,
            type: input.type,
            languageCode,
            channelCode,
            template,
            from: template.from ?? input.from,
            subject: template.subject ?? input.subject,
            templateVars: input.templateVars,
        });
        return { ...result, templateOrigin: origin, templateKind: template.kind };
    }

    /**
     * @description
     * Resolves the template which would be used for an email, without rendering it.
     */
    async resolveTemplate(
        ctx: RequestContext,
        input: Pick<RenderEmailInput, 'type' | 'templateVars' | 'templateFile'> & {
            languageCode: LanguageCode;
            channelCode: string;
        },
    ): Promise<{ template: EmailTemplateSource; origin: EmailTemplateOrigin }> {
        const injector = new Injector(this.moduleRef);
        const templateName = input.templateFile ?? 'body.hbs';
        for (const loader of this.options.templateLoaders) {
            const loaded = toEmailTemplateSource(
                await loader.loadTemplate(injector, ctx, {
                    type: input.type,
                    templateName,
                    templateVars: input.templateVars,
                    languageCode: input.languageCode,
                    channelCode: input.channelCode,
                }),
            );
            if (loaded) {
                return { template: loaded, origin: 'loader' };
            }
        }
        const handlerTemplate = this.options.handlers.find(h => h.type === input.type)?.template;
        if (handlerTemplate) {
            return { template: handlerTemplate, origin: 'handler' };
        }
        const loaderNames = this.options.templateLoaders.map(l => l.constructor.name);
        throw new Error(
            `No template found for email type "${input.type}" ` +
                `(language "${input.languageCode}", channel "${input.channelCode}", template name "${templateName}"). ` +
                (loaderNames.length
                    ? `None of the configured template loaders (${loaderNames.join(', ')}) returned a template, `
                    : 'No template loaders are configured, ') +
                'and the EmailEventHandler has no template set with `.setTemplate()`.',
        );
    }

    private getGenerator(template: EmailTemplateSource): EmailGenerator {
        const generator = this.options.emailGenerators.find(g => g.canGenerate(template));
        if (!generator) {
            throw new Error(
                `None of the configured EmailGenerators can render a template of kind "${template.kind}"`,
            );
        }
        return generator;
    }

    private async initGenerators() {
        const injector = new Injector(this.moduleRef);
        for (const generator of this.options.emailGenerators) {
            if (typeof generator.init === 'function') {
                await generator.init(injector);
            }
            if (typeof generator.onInit === 'function') {
                await generator.onInit(this.options);
            }
        }
    }
}
