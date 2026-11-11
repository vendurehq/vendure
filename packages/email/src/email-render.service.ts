import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { render, toPlainText } from '@react-email/render';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Injector, RequestContext } from '@vendure/core';
import { createElement } from 'react';

import { EMAIL_DATA_TABLE_CLASS } from './components/order-blocks';
import { EMAIL_OPTIONS } from './constants';
import { EmailRenderReactContext } from './template/email-context';
import { EmailTemplate, isPackageDefault } from './template/email-template';
import { interpolateTemplateString } from './template/interpolate';
import { InitializedEmailPluginOptions } from './types';

/**
 * @description
 * Where the template of a rendered email came from:
 *
 * - `override`: passed to `render()` directly, e.g. an unsaved editor draft
 * - `loader:<name>`: a configured {@link EmailTemplateLoader}, e.g. a stored override
 * - `project`: the template set on the project's email definition
 * - `package-default`: the default template shipped with `@vendure/email`
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailRenderService
 * @since 4.0.0
 */
export type EmailTemplateOrigin = 'override' | `loader:${string}` | 'project' | 'package-default';

/**
 * @docsCategory core plugins/Email
 * @docsPage EmailRenderService
 * @since 4.0.0
 */
export interface RenderEmailInput {
    type: string;
    from: string;
    templateVars: Record<string, any>;
    languageCode?: LanguageCode | string;
    channelCode?: string;
    /** Render this template instead of resolving one. */
    template?: EmailTemplate;
}

/**
 * @docsCategory core plugins/Email
 * @docsPage EmailRenderService
 * @since 4.0.0
 */
export interface RenderedEmail {
    from: string;
    subject: string;
    html: string;
    text: string;
    templateOrigin: EmailTemplateOrigin;
}

/**
 * @description
 * Renders an email without sending it. Used for sending, previews, the dashboard and the CLI.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailRenderService
 * @since 4.0.0
 */
@Injectable()
export class EmailRenderService {
    constructor(
        @Inject(EMAIL_OPTIONS) private options: InitializedEmailPluginOptions,
        private moduleRef: ModuleRef,
    ) {}

    async render(ctx: RequestContext, input: RenderEmailInput): Promise<RenderedEmail> {
        const languageCode = (input.languageCode ?? ctx.languageCode) as LanguageCode;
        const channelCode = input.channelCode ?? ctx.channel?.code;
        const { template, origin } = input.template
            ? { template: input.template, origin: 'override' as const }
            : await this.resolveTemplate(ctx, { type: input.type, languageCode, channelCode });
        const vars = input.templateVars;
        const element = createElement(
            EmailRenderReactContext.Provider,
            { value: { type: input.type, languageCode, channelCode } },
            createElement(template.body, vars),
        );
        const html = await render(element);
        const subject =
            typeof template.subject === 'function'
                ? template.subject(vars)
                : interpolateTemplateString(template.subject, vars);
        const text = template.text
            ? template.text(vars)
            : toPlainText(html, {
                  selectors: [
                      {
                          selector: `table.${EMAIL_DATA_TABLE_CLASS}`,
                          format: 'dataTable',
                          options: { maxColumnWidth: 60 },
                      },
                  ],
              });
        return {
            from: interpolateTemplateString(input.from, vars),
            subject,
            html,
            text,
            templateOrigin: origin,
        };
    }

    async resolveTemplate(
        ctx: RequestContext,
        input: { type: string; languageCode: LanguageCode; channelCode: string },
    ): Promise<{ template: EmailTemplate; origin: EmailTemplateOrigin }> {
        const injector = new Injector(this.moduleRef);
        for (const loader of this.options.templateLoaders) {
            const loaded = await loader.load(injector, ctx, input);
            if (loaded) {
                return {
                    template: loaded,
                    origin: `loader:${loader.name ?? loader.constructor.name}`,
                };
            }
        }
        const definition = this.options.emails.find(e => e.type === input.type);
        if (!definition) {
            throw new Error(`No email of type "${input.type}" is configured`);
        }
        return {
            template: definition.template,
            origin: isPackageDefault(definition.template) ? 'package-default' : 'project',
        };
    }
}
