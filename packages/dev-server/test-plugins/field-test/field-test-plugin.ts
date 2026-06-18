import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Collection, PaymentMethodHandler, PluginCommonModule, Product, VendurePlugin } from '@vendure/core';

/**
 * @description
 * A comprehensive test payment handler that exercises every type of configurable operation argument
 * and UI component available in the dashboard. This handler is intended for development and testing
 * purposes only to validate the universal form input system.
 *
 * Tests all DefaultFormComponentId values:
 * - text-form-input, password-form-input, textarea-form-input
 * - number-form-input, currency-form-input, boolean-form-input
 * - select-form-input, date-form-input
 * - rich-text-form-input, json-editor-form-input
 *
 * Tests all ConfigArgType values:
 * - string, int, float, boolean, datetime, ID
 * - Both single values and lists
 * - Various UI configurations (min, max, step, options, etc.)
 */
const comprehensiveTestPaymentHandler = new PaymentMethodHandler({
    code: 'comprehensive-test-payment-handler',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Comprehensive test payment handler with all argument types and UI components',
        },
    ],
    args: {
        // === STRING ARGS ===
        apiKey: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'API Key' }],
            description: [{ languageCode: LanguageCode.en, value: 'Payment gateway API key' }],
            ui: { component: 'password-form-input' },
            required: true,
        },
        merchantId: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Merchant ID' }],
            description: [{ languageCode: LanguageCode.en, value: 'Merchant identifier' }],
            ui: { component: 'test-input' },
            required: true,
        },
        color: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Color' }],
            description: [{ languageCode: LanguageCode.en, value: 'Color code for this payment method' }],
            ui: { component: 'color-picker' },
        },
        supplierEmail: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Supplier Email' }],
            pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
            ui: { component: 'custom-email' },
        },
        environment: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Environment' }],
            description: [{ languageCode: LanguageCode.en, value: 'Payment environment' }],
            ui: {
                component: 'select-form-input',
                options: [
                    { value: 'sandbox', label: [{ languageCode: LanguageCode.en, value: 'Sandbox' }] },
                    { value: 'production', label: [{ languageCode: LanguageCode.en, value: 'Production' }] },
                ],
            },
            defaultValue: 'sandbox',
        },
        webhookUrl: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Webhook URL' }],
            description: [{ languageCode: LanguageCode.en, value: 'Webhook endpoint URL' }],
            ui: { component: 'textarea-form-input' },
        },
        // === STRING LIST ARGS ===
        supportedCurrencies: {
            type: 'string',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Supported Currencies' }],
            description: [{ languageCode: LanguageCode.en, value: 'List of supported currency codes' }],
        },
        allowedCountries: {
            type: 'string',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Allowed Countries' }],
            description: [{ languageCode: LanguageCode.en, value: 'Countries where payment is allowed' }],
            ui: {
                component: 'select-form-input',
                options: [
                    { value: 'US', label: [{ languageCode: LanguageCode.en, value: 'United States' }] },
                    { value: 'GB', label: [{ languageCode: LanguageCode.en, value: 'United Kingdom' }] },
                    { value: 'CA', label: [{ languageCode: LanguageCode.en, value: 'Canada' }] },
                    { value: 'AU', label: [{ languageCode: LanguageCode.en, value: 'Australia' }] },
                ],
            },
        },

        // === INTEGER ARGS ===
        timeout: {
            type: 'int',
            label: [{ languageCode: LanguageCode.en, value: 'Timeout (seconds)' }],
            description: [{ languageCode: LanguageCode.en, value: 'Payment request timeout' }],
            ui: {
                component: 'number-form-input',
                min: 1,
                max: 300,
                step: 1,
                suffix: 's',
            },
            defaultValue: 30,
        },
        maxRetries: {
            type: 'int',
            label: [{ languageCode: LanguageCode.en, value: 'Max Retries' }],
            description: [{ languageCode: LanguageCode.en, value: 'Maximum retry attempts' }],
            ui: {
                component: 'number-form-input',
                min: 0,
                max: 10,
                step: 1,
            },
            defaultValue: 3,
        },

        // === FLOAT ARGS ===
        processingFee: {
            type: 'float',
            label: [{ languageCode: LanguageCode.en, value: 'Processing Fee' }],
            description: [{ languageCode: LanguageCode.en, value: 'Processing fee percentage' }],
            ui: {
                component: 'number-form-input',
                min: 0.0,
                max: 10.0,
                step: 0.01,
                suffix: '%',
            },
            defaultValue: 2.5,
        },
        exchangeRate: {
            type: 'float',
            label: [{ languageCode: LanguageCode.en, value: 'Exchange Rate' }],
            description: [{ languageCode: LanguageCode.en, value: 'Currency exchange rate' }],
            ui: {
                component: 'number-form-input',
                min: 0.01,
                step: 0.0001,
            },
            defaultValue: 1.0,
        },

        // === BOOLEAN ARGS ===
        enableLogging: {
            type: 'boolean',
            label: [{ languageCode: LanguageCode.en, value: 'Enable Logging' }],
            description: [{ languageCode: LanguageCode.en, value: 'Enable detailed logging' }],
            ui: { component: 'boolean-form-input' },
            defaultValue: false,
        },
        requireBillingAddress: {
            type: 'boolean',
            label: [{ languageCode: LanguageCode.en, value: 'Require Billing Address' }],
            description: [{ languageCode: LanguageCode.en, value: 'Require billing address for payments' }],
            ui: { component: 'boolean-form-input' },
            defaultValue: true,
        },
        testMode: {
            type: 'boolean',
            label: [{ languageCode: LanguageCode.en, value: 'Test Mode' }],
            description: [{ languageCode: LanguageCode.en, value: 'Enable test mode' }],
            ui: { component: 'boolean-form-input' },
            defaultValue: true,
        },

        // === DATETIME ARGS ===
        validFrom: {
            type: 'datetime',
            label: [{ languageCode: LanguageCode.en, value: 'Valid From' }],
            description: [{ languageCode: LanguageCode.en, value: 'Payment method valid from date' }],
            ui: { component: 'date-form-input' },
        },
        validUntil: {
            type: 'datetime',
            label: [{ languageCode: LanguageCode.en, value: 'Valid Until' }],
            description: [{ languageCode: LanguageCode.en, value: 'Payment method valid until date' }],
            ui: { component: 'date-form-input' },
        },

        // === ID ARGS ===
        partnerId: {
            type: 'ID',
            label: [{ languageCode: LanguageCode.en, value: 'Partner ID' }],
            description: [{ languageCode: LanguageCode.en, value: 'Payment partner identifier' }],
        },
        vendorId: {
            type: 'ID',
            label: [{ languageCode: LanguageCode.en, value: 'Vendor ID' }],
            description: [{ languageCode: LanguageCode.en, value: 'Payment vendor identifier' }],
        },

        // === SPECIALIZED UI COMPONENTS ===
        baseCurrency: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Base Currency' }],
            description: [{ languageCode: LanguageCode.en, value: 'Base currency for calculations' }],
            ui: { component: 'currency-form-input' },
            defaultValue: 'USD',
        },

        termsAndConditions: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Terms and Conditions' }],
            description: [{ languageCode: LanguageCode.en, value: 'Payment terms and conditions' }],
            ui: { component: 'rich-text-form-input' },
        },

        advancedConfig: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Advanced Configuration' }],
            description: [{ languageCode: LanguageCode.en, value: 'Advanced JSON configuration' }],
            ui: {
                component: 'json-editor-form-input',
                height: '200px',
            },
            defaultValue: '{"webhookRetries": 3, "timeout": 30000}',
        },
    },
    createPayment: async (ctx, order, amount, args, metadata) => {
        // Simulate different payment outcomes based on metadata
        if (metadata.shouldDecline) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: {
                    errorMessage: 'Test decline simulation',
                },
            };
        } else if (metadata.shouldError) {
            return {
                amount,
                state: 'Error' as const,
                errorMessage: 'Test error simulation',
                metadata: {
                    errorMessage: 'Test error simulation',
                },
            };
        } else {
            return {
                amount,
                state: args.testMode ? 'Authorized' : 'Settled',
                transactionId: 'test-' + Math.random().toString(36).substring(2, 7),
                metadata: {
                    ...metadata,
                    processingFee: args.processingFee,
                    environment: args.environment,
                },
            };
        }
    },
    settlePayment: async (ctx, order, payment, args) => {
        if (payment.metadata.shouldErrorOnSettle) {
            return {
                success: false,
                errorMessage: 'Test settlement error simulation',
            };
        }
        return {
            success: true,
            metadata: {
                settledAt: new Date().toISOString(),
                processingFee: args.processingFee,
            },
        };
    },
    cancelPayment: async (ctx, order, payment) => {
        return {
            success: true,
            metadata: {
                cancellationDate: new Date().toISOString(),
                reason: 'Test cancellation',
            },
        };
    },
});

/**
 * @description
 * FieldTestPlugin provides comprehensive test cases for all custom field types and
 * configurable operation argument types supported by Vendure. This plugin is designed
 * specifically for development and testing purposes to validate the universal form
 * input system in the dashboard.
 *
 * ## Custom Fields Coverage
 * Tests all CustomFieldType values on the Product entity:
 * - string (with and without options, lists)
 * - localeString (translatable strings)
 * - text (long text fields)
 * - localeText (translatable long text)
 * - int (with min/max/step validation)
 * - float (with precision controls)
 * - boolean (single and list)
 * - datetime (dates and date lists)
 * - relation (single and multi-relation)
 * - struct (complex objects and lists)
 *
 * ## Configurable Operation Args Coverage
 * Tests all ConfigArgType values and DefaultFormComponentId components:
 * - All basic types: string, int, float, boolean, datetime, ID
 * - All UI components: text, password, textarea, number, currency, boolean,
 *   select, date, rich-text, json-editor
 * - Advanced features: lists, options, validation, prefixes/suffixes
 *
 * ## UI Features Tested
 * - Tab organization
 * - Full-width layouts
 * - Readonly fields
 * - Field validation (min/max/step)
 * - Select options and multi-select
 * - List field management
 * - Custom UI component integration
 *
 * ## Usage
 * 1. Add this plugin to your dev-config.ts plugins array
 * 2. Navigate to any Product detail page to see custom fields
 * 3. Go to Settings → Payment Methods → Add "Comprehensive Test Payment Handler"
 *    to see configurable operation arguments
 *
 * @docsCategory plugin
 * @since 3.4.0
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        // Add comprehensive custom fields to Product entity
        config.customFields.Product.push(
            // === STRING FIELDS ===
            {
                name: 'infoUrl',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Info URL' }],
                description: [{ languageCode: LanguageCode.en, value: 'Product information URL' }],
            },
            {
                name: 'customSku',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Custom SKU' }],
                description: [{ languageCode: LanguageCode.en, value: 'Custom SKU for this product' }],
                readonly: true,
            },
            {
                name: 'supplierEmail',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Supplier Email' }],
                pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
                ui: { component: 'custom-email' },
            },
            {
                name: 'RRP',
                type: 'int',
                label: [{ languageCode: LanguageCode.en, value: 'RRP' }],
                ui: { component: 'multi-currency-input' },
            },
            {
                name: 'simpleTags',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Product tags' }],
                ui: { component: 'tags-input' },
            },
            {
                name: 'color',
                type: 'string',
                pattern: '^#[A-Fa-f0-9]{6}$',
                label: [{ languageCode: LanguageCode.en, value: 'Color' }],
                description: [{ languageCode: LanguageCode.en, value: 'Main color for this product' }],
                ui: {
                    component: 'color-picker',
                },
            },
            {
                name: 'category',
                type: 'string',
                list: false,
                label: [{ languageCode: LanguageCode.en, value: 'Category' }],
                description: [{ languageCode: LanguageCode.en, value: 'Product category selection' }],
                options: [
                    {
                        value: 'electronics',
                        label: [{ languageCode: LanguageCode.en, value: 'Electronics' }],
                    },
                    { value: 'clothing', label: [{ languageCode: LanguageCode.en, value: 'Clothing' }] },
                    { value: 'books', label: [{ languageCode: LanguageCode.en, value: 'Books' }] },
                    { value: 'home', label: [{ languageCode: LanguageCode.en, value: 'Home & Garden' }] },
                ],
            },
            {
                name: 'tags',
                type: 'string',
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'Tags' }],
                description: [{ languageCode: LanguageCode.en, value: 'Product tags (list)' }],
            },
            {
                name: 'features',
                type: 'string',
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'Key Features' }],
                description: [{ languageCode: LanguageCode.en, value: 'List of product features' }],
                options: [
                    { value: 'wireless', label: [{ languageCode: LanguageCode.en, value: 'Wireless' }] },
                    { value: 'waterproof', label: [{ languageCode: LanguageCode.en, value: 'Waterproof' }] },
                    {
                        value: 'rechargeable',
                        label: [{ languageCode: LanguageCode.en, value: 'Rechargeable' }],
                    },
                    { value: 'portable', label: [{ languageCode: LanguageCode.en, value: 'Portable' }] },
                ],
            },

            // === LOCALE STRING FIELDS ===
            {
                name: 'shortName',
                type: 'localeString',
                label: [{ languageCode: LanguageCode.en, value: 'Short Name' }],
                description: [{ languageCode: LanguageCode.en, value: 'Short product name (translatable)' }],
            },
            {
                name: 'seoTitle',
                type: 'localeString',
                label: [{ languageCode: LanguageCode.en, value: 'SEO Title' }],
                description: [{ languageCode: LanguageCode.en, value: 'SEO page title (translatable)' }],
                ui: { tab: 'SEO' },
            },

            // === TEXT FIELDS ===
            {
                name: 'specifications',
                type: 'text',
                label: [{ languageCode: LanguageCode.en, value: 'Specifications' }],
                description: [{ languageCode: LanguageCode.en, value: 'Product specifications (long text)' }],
                ui: { fullWidth: false, component: 'test-input' },
            },
            {
                name: 'warrantyInfo',
                type: 'localeText',
                label: [{ languageCode: LanguageCode.en, value: 'Warranty Information' }],
                description: [
                    { languageCode: LanguageCode.en, value: 'Warranty details (translatable long text)' },
                ],
                ui: { fullWidth: true, tab: 'Details' },
            },

            // === BOOLEAN FIELDS ===
            {
                name: 'downloadable',
                type: 'boolean',
                label: [{ languageCode: LanguageCode.en, value: 'Downloadable' }],
                description: [{ languageCode: LanguageCode.en, value: 'Is this a downloadable product?' }],
            },
            {
                name: 'featured',
                type: 'boolean',
                label: [{ languageCode: LanguageCode.en, value: 'Featured Product' }],
                description: [{ languageCode: LanguageCode.en, value: 'Show on homepage' }],
            },
            {
                name: 'exclusiveOffers',
                type: 'boolean',
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'Exclusive Offers' }],
                description: [{ languageCode: LanguageCode.en, value: 'Multiple boolean values' }],
            },

            // === INTEGER FIELDS ===
            {
                name: 'weight',
                type: 'int',
                label: [{ languageCode: LanguageCode.en, value: 'Weight (grams)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Product weight in grams' }],
                min: 0,
                max: 50000,
                step: 10,
            },
            {
                name: 'priority',
                type: 'int',
                label: [{ languageCode: LanguageCode.en, value: 'Priority' }],
                description: [{ languageCode: LanguageCode.en, value: 'Display priority (1-10)' }],
                min: 1,
                max: 10,
                step: 1,
            },
            {
                name: 'dimensions',
                type: 'int',
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'Dimensions (L×W×H)' }],
                description: [{ languageCode: LanguageCode.en, value: 'Product dimensions in cm' }],
                min: 0,
                max: 1000,
            },

            // === FLOAT FIELDS ===
            {
                name: 'rating',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Average Rating' }],
                description: [{ languageCode: LanguageCode.en, value: 'Average customer rating' }],
                min: 0.0,
                max: 5.0,
                step: 0.1,
                readonly: true,
            },
            {
                name: 'temperature',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Operating Temperature' }],
                description: [{ languageCode: LanguageCode.en, value: 'Operating temperature range' }],
                min: -40.0,
                max: 85.0,
                step: 0.5,
            },
            {
                name: 'measurements',
                type: 'float',
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'Measurements' }],
                description: [{ languageCode: LanguageCode.en, value: 'Precise measurements list' }],
                step: 0.01,
            },

            // === DATETIME FIELDS ===
            {
                name: 'lastUpdated',
                type: 'datetime',
                label: [{ languageCode: LanguageCode.en, value: 'Last Updated' }],
                description: [{ languageCode: LanguageCode.en, value: 'When product was last updated' }],
                readonly: true,
            },
            {
                name: 'releaseDate',
                type: 'datetime',
                label: [{ languageCode: LanguageCode.en, value: 'Release Date' }],
                description: [{ languageCode: LanguageCode.en, value: 'Product release date' }],
            },
            {
                name: 'availabilityDates',
                type: 'datetime',
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'Availability Dates' }],
                description: [{ languageCode: LanguageCode.en, value: 'Special availability dates' }],
            },

            // === RELATION FIELDS ===
            {
                name: 'brand',
                type: 'relation',
                entity: Collection,
                label: [{ languageCode: LanguageCode.en, value: 'Brand' }],
                description: [
                    { languageCode: LanguageCode.en, value: 'Product brand (collection relation)' },
                ],
            },
            {
                name: 'relatedProducts',
                type: 'relation',
                entity: Product,
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'Related Products' }],
                description: [{ languageCode: LanguageCode.en, value: 'List of related products' }],
            },
            {
                name: 'manufacturer',
                type: 'relation',
                entity: Collection,
                label: [{ languageCode: LanguageCode.en, value: 'Manufacturer' }],
                description: [{ languageCode: LanguageCode.en, value: 'Product manufacturer' }],
                ui: { tab: 'Details' },
            },

            // === STRUCT FIELDS ===
            {
                name: 'productSpecs',
                type: 'struct',
                label: [{ languageCode: LanguageCode.en, value: 'Product Specifications' }],
                description: [{ languageCode: LanguageCode.en, value: 'Structured product specifications' }],
                ui: { fullWidth: true, tab: 'Specifications' },
                fields: [
                    { name: 'cpu', type: 'string' as const },
                    { name: 'memory', type: 'int' as const },
                    { name: 'storage', type: 'int' as const },
                    { name: 'display', type: 'string' as const },
                ],
            },
            {
                name: 'variations',
                type: 'struct',
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'Product Variations' }],
                description: [
                    { languageCode: LanguageCode.en, value: 'List of product variant specifications' },
                ],
                ui: { fullWidth: true, tab: 'Variants' },
                fields: [
                    { name: 'color', type: 'string' as const },
                    { name: 'size', type: 'string' as const },
                    { name: 'price', type: 'float' as const },
                    { name: 'inStock', type: 'boolean' as const },
                ],
            },

            // === FIELDS WITH CUSTOM UI COMPONENTS (if available) ===
            {
                name: 'customData',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Custom Data' }],
                description: [{ languageCode: LanguageCode.en, value: 'Field with custom UI component' }],
                ui: {
                    component: 'custom-text-input', // This would need to be registered
                    tab: 'Advanced',
                },
            },

            // === FIELDS WITH TABS ===
            {
                name: 'seoDescription',
                type: 'text',
                label: [{ languageCode: LanguageCode.en, value: 'SEO Description' }],
                description: [{ languageCode: LanguageCode.en, value: 'SEO meta description' }],
                ui: { tab: 'SEO', fullWidth: true },
            },
            {
                name: 'seoKeywords',
                type: 'string',
                list: true,
                label: [{ languageCode: LanguageCode.en, value: 'SEO Keywords' }],
                description: [{ languageCode: LanguageCode.en, value: 'SEO keywords' }],
                ui: { tab: 'SEO' },
            },
            {
                name: 'technicalNotes',
                type: 'text',
                label: [{ languageCode: LanguageCode.en, value: 'Technical Notes' }],
                description: [{ languageCode: LanguageCode.en, value: 'Internal technical notes' }],
                ui: { tab: 'Internal', fullWidth: true },
            },
            {
                name: 'internalCode',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Internal Code' }],
                description: [{ languageCode: LanguageCode.en, value: 'Internal tracking code' }],
                ui: { tab: 'Internal' },
            },
        );

        // Add comprehensive test payment handler
        config.paymentOptions.paymentMethodHandlers.push(comprehensiveTestPaymentHandler);

        return config;
    },
    dashboard: './dashboard/index.tsx',
})
export class FieldTestPlugin {}
