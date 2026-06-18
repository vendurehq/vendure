import { Injector, RequestContext } from '@vendure/core';
import fs from 'fs/promises';
import path from 'path';

import { LoadTemplateInput, Partial } from '../types';

import { TemplateLoader } from './template-loader';

/**
 * @description
 * Loads email templates from the local file system. This is the default
 * loader used by the EmailPlugin.
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
    ): Promise<string> {
        const templatePath = path.join(this.templatePath, type, templateName);
        return fs.readFile(templatePath, 'utf-8');
    }

    async loadPartials(): Promise<Partial[]> {
        const partialsPath = path.join(this.templatePath, 'partials');
        const partialsFiles = await fs.readdir(partialsPath);
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
