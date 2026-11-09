import { Injector, RequestContext } from '@vendure/core';
import fs from 'fs/promises';
import path from 'path';

import { LoadTemplateInput, Partial } from '../types';

import { TemplateLoader } from './template-loader';

/**
 * @description
 * Loads Handlebars/MJML email templates from the local file system, from
 * `<templatePath>/<email type>/<template name>` (by default `body.hbs`).
 *
 * If no file exists for an email type, the loader returns `undefined`, so the template set on the
 * {@link EmailEventHandler} with `setTemplate()` is used instead. This lets you migrate templates to
 * React one at a time: delete a type's `.hbs` file once its React template is in place.
 *
 * @deprecated Handlebars/MJML templates are deprecated. Use React templates set with
 * `EmailEventHandler.setTemplate()` instead.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage TemplateLoader
 */
export class FileBasedTemplateLoader implements TemplateLoader {
    constructor(private templatePath: string) {}

    async loadTemplate(
        _injector: Injector,
        _ctx: RequestContext,
        { type, templateName }: LoadTemplateInput,
    ): Promise<string | undefined> {
        const templatePath = path.join(this.templatePath, type, templateName);
        try {
            return await fs.readFile(templatePath, 'utf-8');
        } catch (e: any) {
            if (e?.code === 'ENOENT') {
                return undefined;
            }
            throw e;
        }
    }

    async loadPartials(): Promise<Partial[]> {
        const partialsPath = path.join(this.templatePath, 'partials');
        let partialsFiles: string[];
        try {
            partialsFiles = await fs.readdir(partialsPath);
        } catch (e: any) {
            if (e?.code === 'ENOENT') {
                return [];
            }
            throw e;
        }
        return Promise.all(
            partialsFiles.map(async file => {
                return {
                    name: path.basename(file, '.hbs'),
                    content: await fs.readFile(path.join(partialsPath, file), 'utf-8'),
                };
            }),
        );
    }
}
