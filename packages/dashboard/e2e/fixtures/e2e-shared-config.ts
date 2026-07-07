import { CustomFields, dummyPaymentHandler, LanguageCode } from '@vendure/core';

/**
 * Custom fields and payment handlers used by global-setup.ts to configure
 * the Vendure backend server for E2E tests.
 *
 * These are NOT included in e2e-vendure-config.ts (the Vite plugin config).
 * The Vite plugin generates the dashboard's GraphQL schema from its config,
 * and including struct custom fields there causes product creation mutations
 * to break (the form sends empty struct data that the backend rejects).
 * The dashboard discovers custom fields at runtime from the backend API.
 *
 * This file is separate from global-setup.ts because it contains only plain
 * data — no NestJS plugins or decorators that would require SWC compilation.
 */

export const e2eCustomFields: CustomFields = {
    Product: [
        // ── General tab (default) ──
        {
            name: 'infoUrl',
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Info URL' }],
        },
        {
            name: 'weight',
            type: 'float',
            label: [{ languageCode: LanguageCode.en, value: 'Weight' }],
        },
        {
            name: 'reviewRating',
            type: 'int',
            label: [{ languageCode: LanguageCode.en, value: 'Review Rating' }],
        },
        {
            name: 'isDownloadable',
            type: 'boolean',
            label: [{ languageCode: LanguageCode.en, value: 'Downloadable' }],
        },
        {
            name: 'releaseDate',
            type: 'datetime',
            label: [{ languageCode: LanguageCode.en, value: 'Release Date' }],
        },
        {
            name: 'additionalInfo',
            type: 'text',
            label: [{ languageCode: LanguageCode.en, value: 'Additional Info' }],
        },
        {
            name: 'priority',
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Priority' }],
            options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
        },
        {
            name: 'featureType',
            type: 'string',
            nullable: true,
            label: [{ languageCode: LanguageCode.en, value: 'Feature Type' }],
            options: [{ value: 'standard' }, { value: 'premium' }],
        },
        // ── SEO tab ──
        {
            name: 'seoTitle',
            type: 'localeString',
            label: [{ languageCode: LanguageCode.en, value: 'SEO Title' }],
            ui: { tab: 'SEO' },
        },
        {
            name: 'seoDescription',
            type: 'localeText',
            label: [{ languageCode: LanguageCode.en, value: 'SEO Description' }],
            ui: { tab: 'SEO', fullWidth: true },
        },
        // ── Details tab ──
        {
            name: 'detailNotes',
            type: 'text',
            label: [{ languageCode: LanguageCode.en, value: 'Detail Notes' }],
            ui: { tab: 'Details', fullWidth: true },
        },
        // ── Lists tab ──
        {
            name: 'tags',
            type: 'string',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Tags' }],
            ui: { tab: 'Lists' },
        },
        // ── Struct tab ──
        {
            name: 'specifications',
            type: 'struct',
            label: [{ languageCode: LanguageCode.en, value: 'Specifications' }],
            ui: { tab: 'Struct' },
            fields: [
                {
                    name: 'material',
                    type: 'string',
                    label: [{ languageCode: LanguageCode.en, value: 'Material' }],
                },
                {
                    name: 'height',
                    type: 'float',
                    label: [{ languageCode: LanguageCode.en, value: 'Height' }],
                },
                {
                    name: 'isRecyclable',
                    type: 'boolean',
                    label: [{ languageCode: LanguageCode.en, value: 'Recyclable' }],
                },
                {
                    name: 'certifications',
                    type: 'string',
                    list: true,
                    label: [{ languageCode: LanguageCode.en, value: 'Certifications' }],
                },
            ],
        },
        {
            name: 'dimensions',
            type: 'struct',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Dimensions' }],
            ui: { tab: 'Struct' },
            fields: [
                {
                    name: 'dimensionName',
                    type: 'string',
                    label: [{ languageCode: LanguageCode.en, value: 'Dimension Name' }],
                },
                {
                    name: 'dimensionValue',
                    type: 'float',
                    label: [{ languageCode: LanguageCode.en, value: 'Dimension Value' }],
                },
                {
                    name: 'dimensionUnit',
                    type: 'string',
                    label: [{ languageCode: LanguageCode.en, value: 'Dimension Unit' }],
                },
            ],
        },
    ],
};

export const e2ePaymentMethodHandlers = [dummyPaymentHandler];
