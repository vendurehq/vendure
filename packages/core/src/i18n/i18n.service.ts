import { Injectable, OnModuleInit } from '@nestjs/common';
import { Handler, Request } from 'express';
import * as fs from 'fs';
import { GraphQLError } from 'graphql';
import i18next, { TFunction } from 'i18next';
import Backend from 'i18next-fs-backend';
import i18nextMiddleware from 'i18next-http-middleware';
import ICU from 'i18next-icu';
import path from 'path';

import { GraphQLErrorResult } from '../common/error/error-result';
import { Logger } from '../config';
import { ConfigService } from '../config/config.service';

import { I18nError } from './i18n-error';

/**
 * @description
 * I18n resources used for translations
 *
 * @docsCategory common
 * @docsPage I18nService
 */
export interface VendureTranslationResources {
    error: any;
    errorResult: any;
    message: any;
}

export interface I18nRequest extends Request {
    t: TFunction;
}

/**
 * This service is responsible for translating messages from the server before they reach the client.
 * The `i18next-express-middleware` middleware detects the client's preferred language based on
 * the `Accept-Language` header or "lang" query param and adds language-specific translation
 * functions to the Express request / response objects.
 *
 * @docsCategory common
 * @docsPage I18nService
 * @docsWeight 0
 */
@Injectable()
export class I18nService implements OnModuleInit {
    /**
     * The set of language codes we have translation resources for. Used as the i18next
     * `supportedLngs` allow-list. Without this, `i18next-http-middleware` appends every
     * distinct request language code to `options.preload` forever, which is then re-walked
     * (via `Intl.getCanonicalLocales`) on every request — degrading performance over time.
     */
    private readonly supportedLanguages = new Set<string>();

    /**
     * @internal
     * @param configService
     */
    constructor(private configService: ConfigService) {}

    /**
     * @internal
     */
    onModuleInit() {
        for (const langKey of this.getBundledLanguageCodes()) {
            this.supportedLanguages.add(langKey);
        }
        return i18next
            .use(i18nextMiddleware.LanguageDetector)
            .use(Backend as any)
            .use(ICU)
            .init({
                nsSeparator: false,
                preload: Array.from(this.supportedLanguages),
                supportedLngs: Array.from(this.supportedLanguages),
                fallbackLng: 'en',
                detection: {
                    lookupQuerystring: 'languageCode',
                },
                backend: {
                    loadPath: path.join(__dirname, 'messages/{{lng}}.json'),
                    jsonIndent: 2,
                },
            });
    }

    /**
     * Reads the language codes for which we ship message files, derived from the filenames
     * in the `messages` directory (e.g. `en.json` -> `en`, `pt_BR.json` -> `pt_BR`). Falls
     * back to a static list if the directory cannot be read.
     */
    private getBundledLanguageCodes(): string[] {
        const fallback = ['en', 'de', 'es', 'fr', 'pt_BR', 'pt_PT', 'ru', 'uk'];
        try {
            const messagesDir = path.join(__dirname, 'messages');
            const codes = fs
                .readdirSync(messagesDir)
                .filter(file => file.endsWith('.json'))
                .map(file => path.basename(file, '.json'));
            return codes.length ? codes : fallback;
        } catch (e: any) {
            Logger.warn(
                `Could not read i18n messages directory, falling back to default language list: ${e.message as string}`,
                'I18nService',
            );
            return fallback;
        }
    }

    /**
     * Registers a language code as supported, extending the i18next `supportedLngs` allow-list
     * at runtime. Needed because plugins may add translations for new languages after init via
     * {@link addTranslation}. `supportedLngs` is cached inside i18next's `languageUtils` at init
     * time, so both the cached copy and `options` must be updated for the change to take effect.
     */
    private registerSupportedLanguage(langKey: string): void {
        if (this.supportedLanguages.has(langKey)) {
            return;
        }
        this.supportedLanguages.add(langKey);
        const supportedLngs = [...this.supportedLanguages, 'cimode'];
        i18next.options.supportedLngs = supportedLngs;
        const languageUtils = (i18next as any).services?.languageUtils;
        if (languageUtils) {
            languageUtils.supportedLngs = supportedLngs;
        }
    }

    /**
     * @internal
     */
    handle(): Handler {
        // Explicit cast due to type mismatch between express v5 (Vendure core)
        // and express v4 (several transitive dependencies)
        return i18nextMiddleware.handle(i18next) as unknown as Handler;
    }

    /**
     * @description
     * Add a I18n translation by json file
     *
     * @param langKey language key of the I18n translation file
     * @param filePath path to the I18n translation file
     */
    addTranslationFile(langKey: string, filePath: string): void {
        try {
            const rawData = fs.readFileSync(filePath);
            const resources = JSON.parse(rawData.toString('utf-8'));
            this.addTranslation(langKey, resources);
        } catch (err: any) {
            Logger.error(`Could not load resources file ${filePath}`, 'I18nService');
        }
    }

    /**
     * @description
     * Add a I18n translation (key-value) resource
     *
     * @param langKey language key of the I18n translation file
     * @param resources key-value translations
     */
    addTranslation(langKey: string, resources: VendureTranslationResources | any): void {
        this.registerSupportedLanguage(langKey);
        i18next.addResourceBundle(langKey, 'translation', resources, true, true);
    }

    /**
     * Translates the originalError if it is an instance of I18nError.
     * @internal
     */
    translateError(req: I18nRequest, error: GraphQLError) {
        const originalError = error.originalError;
        const t: TFunction = req.t;

        if (t && originalError instanceof I18nError) {
            let translation = originalError.message;
            try {
                translation = t(originalError.message, originalError.variables);
            } catch (e: any) {
                const message =
                    typeof e.message === 'string' ? (e.message as string) : JSON.stringify(e.message);
                translation += ` (Translation format error: ${message})`;
            }
            error.message = translation;
            // We can now safely remove the variables object so that they do not appear in
            // the error returned by the GraphQL API
            delete (originalError as any).variables;
        }

        return error;
    }

    /**
     * Translates the message of an ErrorResult
     * @internal
     */
    translateErrorResult(req: I18nRequest, error: GraphQLErrorResult) {
        const t: TFunction = req.t;
        let translation: string = error.message;
        const key = `errorResult.${error.message}`;
        try {
            translation = t(key, error);
        } catch (e: any) {
            const message = typeof e.message === 'string' ? (e.message as string) : JSON.stringify(e.message);
            translation += ` (Translation format error: ${message})`;
        }
        error.message = translation;
    }
}
