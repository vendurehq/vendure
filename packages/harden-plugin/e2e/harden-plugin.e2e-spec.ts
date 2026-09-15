import { LanguageCode, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { HardenPlugin } from '../src/harden.plugin';

/**
 * Sends a query which is expected to fail, and returns the error messages the server sent back.
 */
async function getErrorMessages(client: { query: (q: any) => Promise<any> }, query: any) {
    try {
        await client.query(query);
    } catch (e: any) {
        return ((e.response?.errors ?? []) as Array<{ message: string }>).map(error => error.message);
    }
    throw new Error('Expected the query to fail, but it succeeded');
}

describe('HardenPlugin', () => {
    const { server, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [HardenPlugin.init({ maxQueryComplexity: 100, apiMode: 'prod' })],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                defaultLanguage: LanguageCode.en,
                defaultZone: 'Europe/London',
                countries: [],
                taxRates: [],
                paymentMethods: [],
                shippingMethods: [],
                collections: [],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('hideFieldSuggestions', () => {
        it('replaces a field-name suggestion with a generic message', async () => {
            const messages = await getErrorMessages(
                shopClient,
                gql`
                    query {
                        products(options: { take: 1 }) {
                            items {
                                nam
                            }
                        }
                    }
                `,
            );

            expect(messages).toEqual(['Invalid request']);
        });

        it('leaves a validation error which carries no suggestion untouched', async () => {
            const messages = await getErrorMessages(
                shopClient,
                gql`
                    query {
                        products(options: { take: 1 }) {
                            items {
                                qqqqqqqqqqqq
                            }
                        }
                    }
                `,
            );

            expect(messages.length).toBe(1);
            expect(messages[0]).toContain('qqqqqqqqqqqq');
            expect(messages[0]).not.toContain('Did you mean');
        });
    });

    describe('maxQueryComplexity', () => {
        it('rejects a query over the configured complexity', async () => {
            const messages = await getErrorMessages(
                shopClient,
                gql`
                    query {
                        products(options: { take: 50 }) {
                            items {
                                id
                                name
                                variants {
                                    id
                                    name
                                    product {
                                        id
                                        variants {
                                            id
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `,
            );

            expect(messages.join(' ')).toContain('too complex');
        });

        it('allows a query under the configured complexity', async () => {
            const result = await shopClient.query(gql`
                query {
                    products(options: { take: 1 }) {
                        totalItems
                    }
                }
            `);

            expect(result.products.totalItems).toBe(0);
        });
    });
});
