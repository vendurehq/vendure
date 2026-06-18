import { mergeConfig, Zone } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig, TEST_SETUP_TIMEOUT_MS } from '../../../e2e-common/test-config';

import {
    RelationDecoratorTestService,
    RelationsDecoratorTestPlugin,
} from './fixtures/test-plugins/relations-decorator-test-plugin';

describe('Relations decorator', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                Order: [
                    {
                        name: 'zone',
                        entity: Zone,
                        type: 'relation',
                    },
                ],
            },
            plugins: [RelationsDecoratorTestPlugin],
        }),
    );
    let testService: RelationDecoratorTestService;

    beforeAll(async () => {
        await server.init({
            initialData,
            customerCount: 1,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
        });
        await adminClient.asSuperAdmin();
        testService = server.app.get(RelationDecoratorTestService);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('empty relations', async () => {
        testService.reset();
        await shopClient.query(gql`
            {
                orders(options: { take: 5 }) {
                    items {
                        id
                    }
                }
            }
        `);
        expect(testService.getRelations()).toEqual([]);
    });

    it('relations specified in query are included', async () => {
        testService.reset();
        await shopClient.query(gql`
            {
                orders(options: { take: 5 }) {
                    items {
                        customer {
                            firstName
                        }
                        lines {
                            featuredAsset {
                                preview
                            }
                        }
                    }
                }
            }
        `);
        expect(testService.getRelations()).toEqual(['customer', 'lines', 'lines.featuredAsset']);
    });

    it('custom field relations are included', async () => {
        testService.reset();
        await shopClient.query(gql`
            {
                orders(options: { take: 5 }) {
                    items {
                        customFields {
                            zone {
                                id
                            }
                        }
                    }
                }
            }
        `);
        expect(testService.getRelations()).toEqual(['customFields.zone']);
    });

    it('relations specified in Calculated decorator are included', async () => {
        testService.reset();
        await shopClient.query(gql`
            {
                orders(options: { take: 5 }) {
                    items {
                        id
                        totalQuantity
                    }
                }
            }
        `);
        expect(testService.getRelations()).toEqual(['lines']);
    });

    it('defaults to a depth of 3', async () => {
        testService.reset();
        await shopClient.query(gql`
            {
                orders(options: { take: 5 }) {
                    items {
                        lines {
                            productVariant {
                                product {
                                    featuredAsset {
                                        preview
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `);
        expect(testService.getRelations()).toEqual([
            'lines',
            'lines.productVariant',
            'lines.productVariant.product',
        ]);
    });

    it('manually set depth of 5', async () => {
        testService.reset();
        await shopClient.query(gql`
            {
                ordersWithDepth5(options: { take: 5 }) {
                    items {
                        lines {
                            productVariant {
                                product {
                                    optionGroups {
                                        options {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `);
        expect(testService.getRelations()).toEqual([
            'lines',
            'lines.productVariant',
            'lines.productVariant.product',
            'lines.productVariant.product.optionGroups',
            'lines.productVariant.product.optionGroups.options',
        ]);
    });
});
