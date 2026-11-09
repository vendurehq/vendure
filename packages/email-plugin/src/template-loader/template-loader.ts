import { Injector, RequestContext } from '@vendure/core';

import { EmailTemplateSource } from '../template/email-template';
import { LoadTemplateInput, Partial } from '../types';

/**
 * @description
 * Loads email templates based on the given request context, type, language and channel.
 *
 * A loader returns either an {@link EmailTemplateSource}, a string (treated as a Handlebars/MJML
 * string template), or `undefined` if it has no template for this email. Several loaders can be
 * configured: they are tried in order, and if none returns a template, the template set on the
 * {@link EmailEventHandler} with `setTemplate()` is used. This makes loaders suitable for overriding
 * the templates defined in code, e.g. per channel or with templates stored in a database.
 *
 * @example
 * ```ts
 * import { EmailPlugin, TemplateLoader } from '\@vendure/email-plugin';
 *
 * class MyTemplateLoader implements TemplateLoader {
 *      loadTemplate(injector, ctx, { type, templateName }){
 *          return myCustomTemplateFunction(ctx);
 *      }
 * }
 *
 * // In vendure-config.ts:
 * ...
 * EmailPlugin.init({
 *     templateLoader: new MyTemplateLoader()
 *     ...
 * })
 * ```
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage TemplateLoader
 * @docsWeight 0
 */
export interface TemplateLoader {
    /**
     * @description
     * Load the template for the given email, or return `undefined` to defer to the next loader
     * (and finally to the template set on the {@link EmailEventHandler}).
     */
    loadTemplate(
        injector: Injector,
        ctx: RequestContext,
        input: LoadTemplateInput,
    ): Promise<EmailTemplateSource | string | undefined>;

    /**
     * @description
     * Load Handlebars partials and return their contents. Only used by the {@link HandlebarsMjmlGenerator}.
     * This method is only called during initialization, i.e. during server startup.
     */
    loadPartials?(): Promise<Partial[]>;
}
