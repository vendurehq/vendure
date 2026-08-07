import { LanguageCode } from '@vendure/common/lib/generated-types';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from '../../config/config.service';

import { ConfigCollector } from './config.collector';

describe('ConfigCollector', () => {
    let collector: ConfigCollector;
    let mockConfigService: Record<string, any>;

    beforeEach(() => {
        mockConfigService = {
            assetOptions: {
                assetStorageStrategy: {
                    constructor: { name: 'LocalAssetStorageStrategy' },
                },
            } as any,
            jobQueueOptions: {
                jobQueueStrategy: {
                    constructor: { name: 'InMemoryJobQueueStrategy' },
                },
            } as any,
            entityOptions: {
                entityIdStrategy: {
                    constructor: { name: 'AutoIncrementIdStrategy' },
                },
                moneyStrategy: {
                    constructor: { name: 'DefaultMoneyStrategy' },
                },
            } as any,
            entityIdStrategy: {
                constructor: { name: 'FallbackIdStrategy' },
            } as any,
            defaultLanguageCode: LanguageCode.en,
            customFields: {
                Product: [{ name: 'customField1' }, { name: 'customField2' }],
                Customer: [{ name: 'customField3' }],
            } as any,
            authOptions: {
                adminAuthenticationStrategy: [
                    { name: 'native', constructor: { name: 'NativeAuthenticationStrategy' } },
                ],
                shopAuthenticationStrategy: [
                    { name: 'native', constructor: { name: 'NativeAuthenticationStrategy' } },
                    { name: 'google', constructor: { name: 'GoogleAuthenticationStrategy' } },
                ],
            } as any,
            systemOptions: {
                cacheStrategy: {
                    constructor: { name: 'InMemoryCacheStrategy' },
                },
            } as any,
            taxOptions: {
                taxLineCalculationStrategy: {
                    constructor: { name: 'DefaultTaxLineCalculationStrategy' },
                },
            } as any,
            orderOptions: {
                orderSellerStrategy: {
                    constructor: { name: 'DefaultOrderSellerStrategy' },
                },
                process: [],
            } as any,
            paymentOptions: {
                paymentMethodHandlers: [
                    { code: 'dummy-payment-handler' },
                    { code: 'stripe-payment-handler' },
                ],
                process: [],
            } as any,
            shippingOptions: {
                shippingCalculators: [{ code: 'default-shipping-calculator' }],
                fulfillmentHandlers: [{ code: 'manual-fulfillment' }],
                process: [],
            } as any,
            promotionOptions: {
                promotionConditions: [{ code: 'min-order' }, { code: 'customer-group' }],
                promotionActions: [{ code: 'order-discount' }],
            } as any,
            schedulerOptions: {
                tasks: [{ name: 'clean-sessions' }],
            } as any,
        };
        collector = new ConfigCollector(mockConfigService as ConfigService);
    });

    describe('collect()', () => {
        // Test success paths first before error paths
        describe('happy path', () => {
            it('returns strategy constructor names', () => {
                const result = collector.collect();

                expect(result.assetStorageType).toBe('LocalAssetStorageStrategy');
                expect(result.jobQueueType).toBe('InMemoryJobQueueStrategy');
                expect(result.entityIdStrategy).toBe('AutoIncrementIdStrategy');
            });

            it('returns defaultLanguage from config', () => {
                const result = collector.collect();

                expect(result.defaultLanguage).toBe(LanguageCode.en);
            });

            it('counts custom fields across all entity types', () => {
                const result = collector.collect();

                expect(result.customFieldsCount).toBe(3); // 2 + 1
            });

            it('returns authentication method names sorted and deduplicated', () => {
                const result = collector.collect();

                expect(result.authenticationMethods).toEqual(['google', 'native']);
            });
        });

        describe('entityIdStrategy fallback', () => {
            it('falls back to entityIdStrategy when entityOptions.entityIdStrategy is undefined', () => {
                mockConfigService.entityOptions = {} as any;

                const result = collector.collect();

                expect(result.entityIdStrategy).toBe('FallbackIdStrategy');
            });

            it('returns unknown when entityOptions is undefined (cannot access fallback)', () => {
                // When entityOptions is undefined, accessing entityOptions.entityIdStrategy
                // throws an error which is caught, returning 'unknown'.
                // This is different from entityOptions being an empty object.
                mockConfigService.entityOptions = undefined as any;

                const result = collector.collect();

                expect(result.entityIdStrategy).toBe('unknown');
            });
        });

        describe('custom fields handling', () => {
            it('returns 0 when no custom fields', () => {
                mockConfigService.customFields = {} as any;

                const result = collector.collect();

                expect(result.customFieldsCount).toBe(0);
            });

            it('handles custom fields with non-array values', () => {
                mockConfigService.customFields = {
                    Product: [{ name: 'field1' }],
                    Customer: undefined,
                    Order: null,
                } as any;

                const result = collector.collect();

                expect(result.customFieldsCount).toBe(1);
            });

            it('handles complex custom fields configuration', () => {
                mockConfigService.customFields = {
                    Product: [{ name: 'f1' }, { name: 'f2' }, { name: 'f3' }],
                    ProductVariant: [{ name: 'f4' }],
                    Customer: [{ name: 'f5' }, { name: 'f6' }],
                    Order: [],
                    OrderLine: [{ name: 'f7' }],
                } as any;

                const result = collector.collect();

                expect(result.customFieldsCount).toBe(7);
            });
        });

        describe('authentication methods handling', () => {
            it('handles empty strategy arrays', () => {
                mockConfigService.authOptions = {
                    adminAuthenticationStrategy: [],
                    shopAuthenticationStrategy: [],
                } as any;

                const result = collector.collect();

                expect(result.authenticationMethods).toEqual([]);
            });

            it('handles null strategy array', () => {
                mockConfigService.authOptions = {
                    adminAuthenticationStrategy: null as any,
                    shopAuthenticationStrategy: [{ name: 'some', constructor: { name: 'SomeStrategy' } }],
                } as any;

                const result = collector.collect();

                // Should return empty array due to error handling
                expect(result.authenticationMethods).toEqual([]);
            });
        });

        describe('minification resilience', () => {
            it('falls back to constructor.name when no .name property', () => {
                mockConfigService.assetOptions = {
                    assetStorageStrategy: {
                        constructor: { name: 'LocalAssetStorageStrategy' },
                    },
                } as any;

                const result = collector.collect();

                expect(result.assetStorageType).toBe('LocalAssetStorageStrategy');
            });

            it('returns unknown when constructor.name is minified (single char)', () => {
                mockConfigService.assetOptions = {
                    assetStorageStrategy: {
                        constructor: { name: 'a' },
                    },
                } as any;

                const result = collector.collect();

                expect(result.assetStorageType).toBe('unknown');
            });

            it('prefers .name property over constructor.name for auth strategies', () => {
                mockConfigService.authOptions = {
                    adminAuthenticationStrategy: [{ name: 'native', constructor: { name: 'a' } }],
                    shopAuthenticationStrategy: [],
                } as any;

                const result = collector.collect();

                expect(result.authenticationMethods).toEqual(['native']);
            });
        });

        describe('error handling', () => {
            // These tests verify graceful degradation when config is malformed

            it('returns "unknown" when assetOptions is undefined', () => {
                mockConfigService.assetOptions = undefined as any;

                const result = collector.collect();

                expect(result.assetStorageType).toBe('unknown');
            });

            it('returns "unknown" when jobQueueOptions is undefined', () => {
                mockConfigService.jobQueueOptions = undefined as any;

                const result = collector.collect();

                expect(result.jobQueueType).toBe('unknown');
            });

            it('returns "unknown" when both entityOptions and entityIdStrategy are undefined', () => {
                mockConfigService.entityOptions = undefined as any;
                mockConfigService.entityIdStrategy = undefined;

                const result = collector.collect();

                expect(result.entityIdStrategy).toBe('unknown');
            });

            it('returns 0 when customFields throws', () => {
                Object.defineProperty(mockConfigService, 'customFields', {
                    get() {
                        throw new Error('Config error');
                    },
                });

                const result = collector.collect();

                expect(result.customFieldsCount).toBe(0);
            });

            it('returns empty array when authOptions is undefined', () => {
                mockConfigService.authOptions = undefined as any;

                const result = collector.collect();

                expect(result.authenticationMethods).toEqual([]);
            });
        });

        describe('strategy names', () => {
            describe('happy path', () => {
                it('returns moneyStrategy name', () => {
                    const result = collector.collect();

                    expect(result.moneyStrategy).toBe('DefaultMoneyStrategy');
                });

                it('returns cacheStrategy name', () => {
                    const result = collector.collect();

                    expect(result.cacheStrategy).toBe('InMemoryCacheStrategy');
                });

                it('returns taxLineCalculationStrategy name', () => {
                    const result = collector.collect();

                    expect(result.taxLineCalculationStrategy).toBe('DefaultTaxLineCalculationStrategy');
                });

                it('returns orderSellerStrategy name', () => {
                    const result = collector.collect();

                    expect(result.orderSellerStrategy).toBe('DefaultOrderSellerStrategy');
                });
            });

            describe('error handling', () => {
                it('returns "unknown" when systemOptions is undefined', () => {
                    mockConfigService.systemOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.cacheStrategy).toBe('unknown');
                });

                it('returns "unknown" when taxOptions is undefined', () => {
                    mockConfigService.taxOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.taxLineCalculationStrategy).toBe('unknown');
                });

                it('returns "unknown" when entityOptions.moneyStrategy is undefined', () => {
                    mockConfigService.entityOptions.moneyStrategy = undefined;

                    const result = collector.collect();

                    expect(result.moneyStrategy).toBe('unknown');
                });

                it('returns "unknown" when orderOptions.orderSellerStrategy is undefined', () => {
                    mockConfigService.orderOptions.orderSellerStrategy = undefined;

                    const result = collector.collect();

                    expect(result.orderSellerStrategy).toBe('unknown');
                });
            });
        });

        describe('integration codes', () => {
            describe('happy path', () => {
                it('returns paymentHandlerCodes', () => {
                    const result = collector.collect();

                    expect(result.paymentHandlerCodes).toEqual([
                        'dummy-payment-handler',
                        'stripe-payment-handler',
                    ]);
                });

                it('returns shippingCalculatorCodes', () => {
                    const result = collector.collect();

                    expect(result.shippingCalculatorCodes).toEqual(['default-shipping-calculator']);
                });

                it('returns fulfillmentHandlerCodes', () => {
                    const result = collector.collect();

                    expect(result.fulfillmentHandlerCodes).toEqual(['manual-fulfillment']);
                });
            });

            describe('error handling', () => {
                it('returns [] when paymentOptions is undefined', () => {
                    mockConfigService.paymentOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.paymentHandlerCodes).toEqual([]);
                });

                it('returns [] when shippingOptions is undefined', () => {
                    mockConfigService.shippingOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.shippingCalculatorCodes).toEqual([]);
                    expect(result.fulfillmentHandlerCodes).toEqual([]);
                });
            });
        });

        describe('customization counts', () => {
            describe('happy path', () => {
                it('returns promotionConditionCount', () => {
                    const result = collector.collect();

                    expect(result.promotionConditionCount).toBe(2);
                });

                it('returns promotionActionCount', () => {
                    const result = collector.collect();

                    expect(result.promotionActionCount).toBe(1);
                });

                it('returns scheduledTaskCount', () => {
                    const result = collector.collect();

                    expect(result.scheduledTaskCount).toBe(1);
                });
            });

            describe('error handling', () => {
                it('returns 0 when promotionOptions is undefined', () => {
                    mockConfigService.promotionOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.promotionConditionCount).toBe(0);
                    expect(result.promotionActionCount).toBe(0);
                });

                it('returns 0 when schedulerOptions is undefined', () => {
                    mockConfigService.schedulerOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.scheduledTaskCount).toBe(0);
                });

                it('returns 0 when schedulerOptions.tasks is undefined', () => {
                    mockConfigService.schedulerOptions = { tasks: undefined } as any;

                    const result = collector.collect();

                    expect(result.scheduledTaskCount).toBe(0);
                });
            });
        });

        describe('custom fields per entity', () => {
            it('returns field counts per entity', () => {
                const result = collector.collect();

                expect(result.customFieldsPerEntity).toEqual({ Product: 2, Customer: 1 });
            });

            it('returns {} when customFields is empty', () => {
                mockConfigService.customFields = {} as any;

                const result = collector.collect();

                expect(result.customFieldsPerEntity).toEqual({});
            });

            it('excludes entities with 0 fields', () => {
                mockConfigService.customFields = {
                    Product: [{ name: 'f1' }, { name: 'f2' }],
                    Customer: [],
                    Order: [{ name: 'f3' }],
                } as any;

                const result = collector.collect();

                expect(result.customFieldsPerEntity).toEqual({ Product: 2, Order: 1 });
            });
        });

        describe('process customization flags', () => {
            describe('happy path', () => {
                it('returns false when orderOptions.process is empty', () => {
                    const result = collector.collect();

                    expect(result.hasCustomOrderProcess).toBe(false);
                });

                it('returns false when paymentOptions.process is empty', () => {
                    const result = collector.collect();

                    expect(result.hasCustomPaymentProcess).toBe(false);
                });

                it('returns false when shippingOptions.process is empty', () => {
                    const result = collector.collect();

                    expect(result.hasCustomFulfillmentProcess).toBe(false);
                });

                it('returns true when process arrays have entries', () => {
                    mockConfigService.orderOptions.process = [{ name: 'custom-order-process' }];
                    mockConfigService.paymentOptions.process = [{ name: 'custom-payment-process' }];
                    mockConfigService.shippingOptions.process = [{ name: 'custom-fulfillment-process' }];

                    const result = collector.collect();

                    expect(result.hasCustomOrderProcess).toBe(true);
                    expect(result.hasCustomPaymentProcess).toBe(true);
                    expect(result.hasCustomFulfillmentProcess).toBe(true);
                });
            });

            describe('error handling', () => {
                it('returns false when orderOptions is undefined', () => {
                    mockConfigService.orderOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.hasCustomOrderProcess).toBe(false);
                });

                it('returns false when paymentOptions is undefined', () => {
                    mockConfigService.paymentOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.hasCustomPaymentProcess).toBe(false);
                });

                it('returns false when shippingOptions is undefined', () => {
                    mockConfigService.shippingOptions = undefined as any;

                    const result = collector.collect();

                    expect(result.hasCustomFulfillmentProcess).toBe(false);
                });
            });
        });

        describe('error paths — forcing failures', () => {
            it('defaultLanguage returns undefined when defaultLanguageCode throws', () => {
                Object.defineProperty(mockConfigService, 'defaultLanguageCode', {
                    get() {
                        throw new Error('Config not initialized');
                    },
                    configurable: true,
                });

                const result = collector.collect();

                expect(result.defaultLanguage).toBeUndefined();
            });

            it('defaultLanguage returns undefined when defaultLanguageCode is undefined', () => {
                mockConfigService.defaultLanguageCode = undefined;

                const result = collector.collect();

                expect(result.defaultLanguage).toBeUndefined();
            });

            it('handles multiple config sections being undefined simultaneously', () => {
                mockConfigService.assetOptions = undefined as any;
                mockConfigService.jobQueueOptions = undefined as any;
                mockConfigService.entityOptions = undefined as any;
                mockConfigService.systemOptions = undefined as any;
                mockConfigService.taxOptions = undefined as any;

                const result = collector.collect();

                expect(result).toBeDefined();
                expect(result.assetStorageType).toBe('unknown');
                expect(result.jobQueueType).toBe('unknown');
                // entityOptions is undefined so accessing entityOptions.entityIdStrategy
                // throws before reaching the fallback, caught by try/catch → 'unknown'
                expect(result.entityIdStrategy).toBe('unknown');
                expect(result.cacheStrategy).toBe('unknown');
                expect(result.taxLineCalculationStrategy).toBe('unknown');
                expect(result.moneyStrategy).toBe('unknown');
                expect(result.customFieldsCount).toBe(3);
                expect(result.authenticationMethods).toEqual(['google', 'native']);
                expect(result.paymentHandlerCodes).toEqual([
                    'dummy-payment-handler',
                    'stripe-payment-handler',
                ]);
                expect(result.shippingCalculatorCodes).toEqual(['default-shipping-calculator']);
                expect(result.fulfillmentHandlerCodes).toEqual(['manual-fulfillment']);
                expect(result.promotionConditionCount).toBe(2);
                expect(result.promotionActionCount).toBe(1);
                expect(result.scheduledTaskCount).toBe(1);
                expect(result.hasCustomOrderProcess).toBe(false);
                expect(result.hasCustomPaymentProcess).toBe(false);
                expect(result.hasCustomFulfillmentProcess).toBe(false);
            });

            it('paymentHandlerCodes includes undefined for handlers missing .code', () => {
                mockConfigService.paymentOptions = {
                    paymentMethodHandlers: [{ code: 'valid' }, {}, { code: undefined }],
                    process: [],
                } as any;

                const result = collector.collect();

                expect(result.paymentHandlerCodes).toEqual(['valid', undefined, undefined]);
            });

            it('shippingCalculatorCodes returns [] when .code getter throws', () => {
                const throwingEntry = {};
                Object.defineProperty(throwingEntry, 'code', {
                    get() {
                        throw new Error('code access error');
                    },
                    configurable: true,
                    enumerable: true,
                });
                mockConfigService.shippingOptions = {
                    shippingCalculators: [throwingEntry],
                    fulfillmentHandlers: [],
                    process: [],
                } as any;

                const result = collector.collect();

                expect(result.shippingCalculatorCodes).toEqual([]);
            });

            it('promotionConditionCount returns 0 when promotionConditions is not an array', () => {
                mockConfigService.promotionOptions = {
                    promotionConditions: 42,
                    promotionActions: [],
                } as any;

                const result = collector.collect();

                expect(result.promotionConditionCount).toBe(0);
            });

            it('customFields handles entities with various broken values', () => {
                mockConfigService.customFields = {
                    Product: [{ name: 'f1' }],
                    Customer: null,
                    Order: 'not an array',
                    Facet: { length: 5 },
                    Address: undefined,
                } as any;

                const result = collector.collect();

                expect(result.customFieldsPerEntity).toEqual({ Product: 1 });
                expect(result.customFieldsCount).toBe(1);
            });

            it('collect() returns safe defaults when all config sections throw on access', () => {
                const throwingProps = [
                    'assetOptions',
                    'jobQueueOptions',
                    'systemOptions',
                    'taxOptions',
                    'paymentOptions',
                    'shippingOptions',
                    'promotionOptions',
                    'schedulerOptions',
                    'orderOptions',
                    'authOptions',
                    'entityOptions',
                    'customFields',
                    'defaultLanguageCode',
                    'entityIdStrategy',
                ];
                for (const prop of throwingProps) {
                    Object.defineProperty(mockConfigService, prop, {
                        get() {
                            throw new Error(`${prop} exploded`);
                        },
                        configurable: true,
                    });
                }

                const result = collector.collect();

                expect(result).toBeDefined();
                expect(result.assetStorageType).toBe('unknown');
                expect(result.jobQueueType).toBe('unknown');
                expect(result.entityIdStrategy).toBe('unknown');
                expect(result.defaultLanguage).toBeUndefined();
                expect(result.customFieldsCount).toBe(0);
                expect(result.customFieldsPerEntity).toEqual({});
                expect(result.authenticationMethods).toEqual([]);
                expect(result.moneyStrategy).toBe('unknown');
                expect(result.cacheStrategy).toBe('unknown');
                expect(result.taxLineCalculationStrategy).toBe('unknown');
                expect(result.orderSellerStrategy).toBe('unknown');
                expect(result.paymentHandlerCodes).toEqual([]);
                expect(result.shippingCalculatorCodes).toEqual([]);
                expect(result.fulfillmentHandlerCodes).toEqual([]);
                expect(result.promotionConditionCount).toBe(0);
                expect(result.promotionActionCount).toBe(0);
                expect(result.scheduledTaskCount).toBe(0);
                expect(result.hasCustomOrderProcess).toBe(false);
                expect(result.hasCustomPaymentProcess).toBe(false);
                expect(result.hasCustomFulfillmentProcess).toBe(false);
            });
        });

        describe('API / security posture', () => {
            beforeEach(() => {
                mockConfigService.apiOptions = {
                    introspection: false,
                    adminApiPlayground: true,
                    shopApiPlayground: false,
                    adminApiDebug: false,
                    shopApiDebug: false,
                    trustProxy: true,
                    cors: { origin: '*', credentials: true },
                } as any;
                mockConfigService.authOptions = {
                    ...mockConfigService.authOptions,
                    tokenMethod: ['cookie', 'bearer'],
                    requireVerification: false,
                    disableAuth: true,
                    superadminCredentials: { identifier: 'superadmin', password: 'superadmin' },
                    cookieOptions: { secure: true, sameSite: 'strict' },
                };
                mockConfigService.settingsStoreFields = {
                    dashboard: [{ name: 'a' }, { name: 'b' }],
                    theme: [{ name: 'c' }],
                } as any;
            });

            it('reduces api/auth posture to booleans and short enums', () => {
                const result = collector.collect();

                expect(result.apiIntrospectionEnabled).toBe(false);
                expect(result.apiPlaygroundEnabled).toBe(true);
                expect(result.apiDebugEnabled).toBe(false);
                expect(result.trustProxyEnabled).toBe(true);
                expect(result.corsWildcardOrigin).toBe(true);
                expect(result.tokenMethods).toEqual(['cookie', 'bearer']);
                expect(result.requireVerification).toBe(false);
                expect(result.authDisabled).toBe(true);
                expect(result.cookieSecure).toBe(true);
                expect(result.cookieSameSite).toBe('strict');
                expect(result.settingsStoreFieldCount).toBe(3);
            });

            it('introspection defaults to enabled when not explicitly disabled', () => {
                mockConfigService.apiOptions = {} as any;
                expect(collector.collect().apiIntrospectionEnabled).toBe(true);
            });

            it('treats cors: true as a wildcard origin', () => {
                mockConfigService.apiOptions = { cors: true } as any;
                expect(collector.collect().corsWildcardOrigin).toBe(true);
            });

            it('reports corsWildcardOrigin false when cors is disabled', () => {
                mockConfigService.apiOptions = { cors: false } as any;
                expect(collector.collect().corsWildcardOrigin).toBe(false);
            });

            it('reports corsWildcardOrigin false for a specific origin', () => {
                mockConfigService.apiOptions = {
                    cors: { origin: 'https://example.com' },
                } as any;
                expect(collector.collect().corsWildcardOrigin).toBe(false);
            });

            it('normalizes a single tokenMethod string to an array', () => {
                mockConfigService.authOptions = { tokenMethod: 'bearer' } as any;
                expect(collector.collect().tokenMethods).toEqual(['bearer']);
            });

            it('detects the default superadmin credentials', () => {
                expect(collector.collect().defaultSuperadminCredentials).toBe(true);
            });

            it('returns false and never reads the actual values for changed credentials', () => {
                mockConfigService.authOptions = {
                    ...mockConfigService.authOptions,
                    superadminCredentials: { identifier: 'admin', password: 'hunter2' },
                };
                expect(collector.collect().defaultSuperadminCredentials).toBe(false);
            });
        });

        describe('customizedStrategies', () => {
            it('flags only single-strategy fields that differ from the default config', () => {
                mockConfigService.assetOptions = {
                    // Differs from the default NoAssetStorageStrategy
                    assetStorageStrategy: { constructor: { name: 'S3AssetStorageStrategy' } },
                    // Matches the default
                    assetNamingStrategy: { constructor: { name: 'DefaultAssetNamingStrategy' } },
                    assetPreviewStrategy: { constructor: { name: 'NoAssetPreviewStrategy' } },
                } as any;

                const result = collector.collect();

                expect(result.customizedStrategies).toContain('assetOptions.assetStorageStrategy');
                expect(result.customizedStrategies).not.toContain('assetOptions.assetNamingStrategy');
                expect(result.customizedStrategies).not.toContain('assetOptions.assetPreviewStrategy');
            });

            it('emits dotted paths, never strategy class names', () => {
                mockConfigService.assetOptions = {
                    assetStorageStrategy: { constructor: { name: 'SecretInternalStorageStrategy' } },
                } as any;

                const paths = collector.collect().customizedStrategies ?? [];

                expect(paths).toContain('assetOptions.assetStorageStrategy');
                for (const path of paths) {
                    expect(path).not.toContain('SecretInternalStorageStrategy');
                }
            });

            it('detects a customized entity access control strategy', () => {
                mockConfigService.authOptions = {
                    ...mockConfigService.authOptions,
                    entityAccessControlStrategy: {
                        constructor: { name: 'CustomEntityAccessControlStrategy' },
                    },
                };

                expect(collector.collect().customizedStrategies).toContain(
                    'authOptions.entityAccessControlStrategy',
                );
            });

            it('detects a customized active order strategy array', () => {
                mockConfigService.orderOptions = {
                    ...mockConfigService.orderOptions,
                    activeOrderStrategy: [
                        { constructor: { name: 'DefaultActiveOrderStrategy' } },
                        { constructor: { name: 'CustomActiveOrderStrategy' } },
                    ],
                };

                expect(collector.collect().customizedStrategies).toContain(
                    'orderOptions.activeOrderStrategy',
                );
            });

            it('treats a default-equivalent active order strategy array as unchanged', () => {
                mockConfigService.orderOptions = {
                    ...mockConfigService.orderOptions,
                    activeOrderStrategy: [{ constructor: { name: 'DefaultActiveOrderStrategy' } }],
                };

                expect(collector.collect().customizedStrategies).not.toContain(
                    'orderOptions.activeOrderStrategy',
                );
            });

            it('detects a customized strategy set via the deprecated root-level entityIdStrategy', () => {
                // entityOptions.entityIdStrategy is unset; the project configured the
                // deprecated root-level entityIdStrategy instead. The fallback should
                // still surface it as customized against the default.
                mockConfigService.entityOptions = { moneyStrategy: undefined } as any;
                (mockConfigService as any).entityIdStrategy = {
                    constructor: { name: 'CustomEntityIdStrategy' },
                };

                expect(collector.collect().customizedStrategies).toContain('entityOptions.entityIdStrategy');
            });

            it('does not flag entityIdStrategy when the root-level fallback matches the default', () => {
                mockConfigService.entityOptions = {} as any;
                (mockConfigService as any).entityIdStrategy = {
                    constructor: { name: 'AutoIncrementIdStrategy' },
                };

                expect(collector.collect().customizedStrategies).not.toContain(
                    'entityOptions.entityIdStrategy',
                );
            });

            it('returns an empty array when no strategies are customized', () => {
                // The base mock uses default-equivalent strategies for the fields it defines
                mockConfigService.assetOptions = {
                    assetStorageStrategy: { constructor: { name: 'NoAssetStorageStrategy' } },
                } as any;
                mockConfigService.entityOptions = {
                    entityIdStrategy: { constructor: { name: 'AutoIncrementIdStrategy' } },
                    moneyStrategy: { constructor: { name: 'DefaultMoneyStrategy' } },
                } as any;
                mockConfigService.orderOptions = { orderSellerStrategy: undefined, process: [] } as any;
                mockConfigService.taxOptions = {} as any;
                mockConfigService.systemOptions = {} as any;
                mockConfigService.jobQueueOptions = {} as any;

                expect(collector.collect().customizedStrategies).toEqual([]);
            });
        });
    });
});
