import { LanguageCode, LogicalOperator, SortOrder } from '@vendure/common/lib/generated-types';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { ListQueryPlugin } from './fixtures/test-plugins/list-query-plugin';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { fixPostgresTimezone } from './utils/fix-pg-timezone';
import { sortById } from './utils/test-order-utils';

fixPostgresTimezone();

describe('ListQueryBuilder', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            apiOptions: {
                shopListQueryLimit: 10,
                adminListQueryLimit: 30,
            },
            plugins: [ListQueryPlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    function getItemLabels(items: any[]): string[] {
        return items.map((x: any) => x.label).sort();
    }

    describe('pagination', () => {
        it('all en', async () => {
            const { testEntities } = await adminClient.query(
                GET_LIST,
                {
                    options: {},
                },
                { languageCode: LanguageCode.en },
            );

            expect(testEntities.totalItems).toBe(6);
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
            expect(testEntities.items.map((i: any) => i.name)).toEqual(
                expect.arrayContaining([
                    'apple',
                    'bike',
                    'cake',
                    'dog',
                    'egg',
                    'baum', // if default en lang does not exist, use next available lang
                ]),
            );
        });

        it('all de', async () => {
            const { testEntities } = await adminClient.query(
                GET_LIST,
                {
                    options: {},
                },
                { languageCode: LanguageCode.de },
            );

            expect(testEntities.totalItems).toBe(6);
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
            expect(testEntities.items.map((i: any) => i.name)).toEqual(
                expect.arrayContaining([
                    'apfel',
                    'fahrrad',
                    'kuchen',
                    'hund',
                    'egg', // falls back to en translation when de doesn't exist
                    'baum',
                ]),
            );
        });

        it('take', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    take: 2,
                },
            });

            expect(testEntities.totalItems).toBe(6);
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B']);
        });

        it('skip', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    skip: 2,
                },
            });

            expect(testEntities.totalItems).toBe(6);
            expect(getItemLabels(testEntities.items)).toEqual(['C', 'D', 'E', 'F']);
        });

        it('skip negative is ignored', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    skip: -1,
                },
            });

            expect(testEntities.totalItems).toBe(6);
            expect(testEntities.items.length).toBe(6);
        });

        it('take zero is ignored', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    take: 0,
                },
            });

            expect(testEntities.totalItems).toBe(6);
            expect(testEntities.items.length).toBe(6);
        });

        it('take negative is ignored', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    take: -1,
                },
            });

            expect(testEntities.totalItems).toBe(6);
            expect(testEntities.items.length).toBe(6);
        });

        it(
            'take beyond adminListQueryLimit',
            assertThrowsWithMessage(async () => {
                await adminClient.query(GET_LIST, {
                    options: {
                        take: 50,
                    },
                });
            }, 'Cannot take more than 30 results from a list query'),
        );

        it(
            'take beyond shopListQueryLimit',
            assertThrowsWithMessage(async () => {
                await shopClient.query(GET_LIST, {
                    options: {
                        take: 50,
                    },
                });
            }, 'Cannot take more than 10 results from a list query'),
        );
    });

    describe('string filtering', () => {
        it('eq', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        label: {
                            eq: 'B',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B']);
        });

        it('notEq', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        label: {
                            notEq: 'B',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'D', 'E', 'F']);
        });

        it('contains', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        description: {
                            contains: 'adip',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['C']);
        });

        it('notContains', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        description: {
                            notContains: 'te',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E', 'F']);
        });

        it('in', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        label: {
                            in: ['A', 'C'],
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C']);
        });

        it('notIn', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        label: {
                            notIn: ['A', 'C'],
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B', 'D', 'E', 'F']);
        });

        it('isNull true', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableString: {
                            isNull: true,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B', 'D', 'F']);
        });

        it('isNull false', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableString: {
                            isNull: false,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'E']);
        });

        it('filtering on translatable string', async () => {
            const { testEntities } = await adminClient.query(GET_LIST_WITH_TRANSLATIONS, {
                options: {
                    filter: {
                        name: {
                            contains: 'g',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['D', 'E']);
        });

        describe('regex', () => {
            it('simple substring', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: 'or',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'D']);
            });

            it('start of string', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: '^in',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['E']);
            });

            it('end of string', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: 'or$',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['D']);
            });

            it('alternation', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: 'dolor|tempor',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['B', 'D']);
            });

            it('complex', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: '(dolor|tempor)|inc[i]?d[^a]d.*nt',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['B', 'D', 'E']);
            });
        });
    });

    describe('ID filtering', () => {
        it('eq', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        ownerId: {
                            eq: 'T_13',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['D']);
        });

        it('notEq', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        ownerId: {
                            notEq: 'T_13',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'E', 'F']);
        });

        it('in', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        ownerId: {
                            in: ['T_10', 'T_15'],
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'F']);
        });

        it('in with empty set', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        ownerId: {
                            in: [],
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual([]);
        });

        it('notIn', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        ownerId: {
                            notIn: ['T_10', 'T_15'],
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B', 'C', 'D', 'E']);
        });

        it('notIn with empty set', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        ownerId: {
                            notIn: [],
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
        });

        it('isNull true', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableId: {
                            isNull: true,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B', 'D', 'F']);
        });

        it('isNull false', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableId: {
                            isNull: false,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'E']);
        });

        describe('regex', () => {
            it('simple substring', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: 'or',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'D']);
            });

            it('start of string', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: '^in',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['E']);
            });

            it('end of string', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: 'or$',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['D']);
            });

            it('alternation', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: 'dolor|tempor',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['B', 'D']);
            });

            it('complex', async () => {
                const { testEntities } = await adminClient.query(GET_LIST, {
                    options: {
                        filter: {
                            description: {
                                regex: '(dolor|tempor)|inc[i]?d[^a]d.*nt',
                            },
                        },
                    },
                });

                expect(getItemLabels(testEntities.items)).toEqual(['B', 'D', 'E']);
            });
        });
    });

    describe('boolean filtering', () => {
        it('eq', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        active: {
                            eq: false,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['C', 'E', 'F']);
        });

        it('isNull true', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableBoolean: {
                            isNull: true,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B', 'D', 'F']);
        });

        it('isNull false', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableBoolean: {
                            isNull: false,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'E']);
        });
    });

    describe('number filtering', () => {
        it('eq', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        order: {
                            eq: 1,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B']);
        });

        it('lt', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        order: {
                            lt: 1,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A']);
        });

        it('lte', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        order: {
                            lte: 1,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B']);
        });

        it('gt', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        order: {
                            gt: 1,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['C', 'D', 'E', 'F']);
        });

        it('gte', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        order: {
                            gte: 1,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B', 'C', 'D', 'E', 'F']);
        });

        it('between', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        order: {
                            between: {
                                start: 2,
                                end: 4,
                            },
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['C', 'D', 'E']);
        });

        it('isNull true', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableNumber: {
                            isNull: true,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B', 'D', 'F']);
        });

        it('isNull false', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableNumber: {
                            isNull: false,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'E']);
        });
    });

    describe('date filtering', () => {
        it('before', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        date: {
                            before: '2020-01-20T10:00:00.000Z',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B']);
        });

        it('before on same date', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        date: {
                            before: '2020-01-15T17:00:00.000Z',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B']);
        });

        it('after', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        date: {
                            after: '2020-01-20T10:00:00.000Z',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['C', 'D', 'E', 'F']);
        });

        it('after on same date', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        date: {
                            after: '2020-01-25T09:00:00.000Z',
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['C', 'D', 'E', 'F']);
        });

        it('between', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        date: {
                            between: {
                                start: '2020-01-10T10:00:00.000Z',
                                end: '2020-01-20T10:00:00.000Z',
                            },
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B']);
        });

        it('isNull true', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableDate: {
                            isNull: true,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['B', 'D', 'F']);
        });

        it('isNull false', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        nullableDate: {
                            isNull: false,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'E']);
        });
    });

    describe('multiple filters with filterOperator', () => {
        it('default AND', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        description: {
                            contains: 'Lorem',
                        },
                        active: {
                            eq: false,
                        },
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual([]);
        });

        it('explicit AND', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        description: {
                            contains: 'Lorem',
                        },
                        active: {
                            eq: false,
                        },
                    },
                    filterOperator: LogicalOperator.AND,
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual([]);
        });

        it('explicit OR', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        description: {
                            contains: 'Lorem',
                        },
                        active: {
                            eq: false,
                        },
                    },
                    filterOperator: LogicalOperator.OR,
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'E', 'F']);
        });

        it('explicit OR with 3 filters', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        description: {
                            contains: 'eiusmod',
                        },
                        active: {
                            eq: false,
                        },
                        order: {
                            lt: 3,
                        },
                    },
                    filterOperator: LogicalOperator.OR,
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
        });

        it('explicit OR with empty filters object', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {},
                    filterOperator: LogicalOperator.OR,
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
        });
    });

    describe('complex boolean logic with _and & _or', () => {
        it('single _and', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        _and: [
                            {
                                description: {
                                    contains: 'Lorem',
                                },
                                active: {
                                    eq: false,
                                },
                            },
                        ],
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual([]);
        });

        it('single _or', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        _or: [
                            {
                                description: {
                                    contains: 'Lorem',
                                },
                                active: {
                                    eq: false,
                                },
                            },
                        ],
                    },
                },
            });

            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'E', 'F']);
        });

        it('_or with nested _and', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        _or: [
                            {
                                description: { contains: 'Lorem' },
                            },
                            {
                                _and: [{ order: { gt: 3 } }, { order: { lt: 5 } }],
                            },
                        ],
                    },
                },
            });
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'E']);
        });

        it('_and with nested _or', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        _and: [
                            {
                                description: { contains: 'e' },
                            },
                            {
                                _or: [{ active: { eq: false } }, { ownerId: { eq: 'T_10' } }],
                            },
                        ],
                    },
                },
            });
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'C', 'F']);
        });
    });

    describe('sorting', () => {
        it('sort by string', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        label: SortOrder.DESC,
                    },
                },
            });

            expect(testEntities.items.map((x: any) => x.label)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
        });

        it('sort by number', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        order: SortOrder.DESC,
                    },
                },
            });
            expect(testEntities.items.map((x: any) => x.label)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
        });

        it('sort by date', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        date: SortOrder.DESC,
                    },
                },
            });
            expect(testEntities.items.map((x: any) => x.label)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
        });

        it('sort by ID', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        id: SortOrder.DESC,
                    },
                },
            });
            expect(testEntities.items.map((x: any) => x.label)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
        });

        it('sort by translated field en', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        name: SortOrder.ASC,
                    },
                },
            });
            expect(testEntities.items.map((x: any) => x.name)).toEqual([
                'apple',
                'baum', // falling back to de here
                'bike',
                'cake',
                'dog',
                'egg',
            ]);
        });

        it('sort by translated field de', async () => {
            const { testEntities } = await adminClient.query(
                GET_LIST,
                {
                    options: {
                        sort: {
                            name: SortOrder.ASC,
                        },
                    },
                },
                { languageCode: LanguageCode.de },
            );
            expect(testEntities.items.map((x: any) => x.name)).toEqual([
                'apfel',
                'baum',
                'egg',
                'fahrrad',
                'hund',
                'kuchen',
            ]);
        });

        it('sort by translated field en with take', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        name: SortOrder.ASC,
                    },
                    take: 4,
                },
            });
            expect(testEntities.items.map((x: any) => x.name)).toEqual(['apple', 'baum', 'bike', 'cake']);
        });

        it('sort by translated field de with take', async () => {
            const { testEntities } = await adminClient.query(
                GET_LIST,
                {
                    options: {
                        sort: {
                            name: SortOrder.ASC,
                        },
                        take: 4,
                    },
                },
                { languageCode: LanguageCode.de },
            );
            expect(testEntities.items.map((x: any) => x.name)).toEqual(['apfel', 'baum', 'egg', 'fahrrad']);
        });
    });

    describe('calculated fields', () => {
        it('filter by simple calculated property', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        descriptionLength: {
                            lt: 12,
                        },
                    },
                },
            });
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B']);
        });

        it('filter by calculated property with boolean expression', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        _and: [
                            {
                                descriptionLength: {
                                    lt: 12,
                                },
                            },
                        ],
                    },
                },
            });
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B']);
        });

        it('filter by calculated property with join', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        price: {
                            lt: 14,
                        },
                    },
                },
            });
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E']);
        });

        it('filter by calculated property with join and boolean expression', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    filter: {
                        _and: [
                            {
                                price: {
                                    lt: 14,
                                },
                            },
                        ],
                    },
                },
            });
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E']);
        });

        it('sort by simple calculated property', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        descriptionLength: SortOrder.ASC,
                    },
                },
            });
            expect(testEntities.items.map((x: any) => x.label)).toEqual(['B', 'A', 'E', 'D', 'C', 'F']);
        });

        it('sort by calculated property with join', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        price: SortOrder.ASC,
                    },
                },
            });
            expect(testEntities.items.map((x: any) => x.label)).toEqual(['B', 'A', 'E', 'D', 'C', 'F']);
        });
    });

    describe('multiple clauses', () => {
        it('sort by translated field en & filter', async () => {
            const { testEntities } = await adminClient.query(GET_LIST, {
                options: {
                    sort: {
                        name: SortOrder.ASC,
                    },
                    filter: {
                        order: {
                            gte: 1,
                        },
                    },
                },
            });
            expect(testEntities.items.map((x: any) => x.name)).toEqual([
                'baum',
                'bike',
                'cake',
                'dog',
                'egg',
            ]);
        });

        it('sort by translated field de & filter', async () => {
            const { testEntities } = await adminClient.query(
                GET_LIST,
                {
                    options: {
                        sort: {
                            name: SortOrder.ASC,
                        },
                        filter: {
                            order: {
                                gte: 1,
                            },
                        },
                    },
                },
                { languageCode: LanguageCode.de },
            );
            expect(testEntities.items.map((x: any) => x.name)).toEqual([
                'baum',
                'egg',
                'fahrrad',
                'hund',
                'kuchen',
            ]);
        });

        it('sort by translated field de & filter & pagination', async () => {
            const { testEntities } = await adminClient.query(
                GET_LIST,
                {
                    options: {
                        sort: {
                            name: SortOrder.ASC,
                        },
                        filter: {
                            order: {
                                gte: 1,
                            },
                        },
                        take: 2,
                        skip: 1,
                    },
                },
                { languageCode: LanguageCode.de },
            );
            expect(testEntities.items.map((x: any) => x.name)).toEqual(['egg', 'fahrrad']);
        });
    });

    // https://github.com/vendurehq/vendure/issues/1586
    it('using the getMany() of the resulting QueryBuilder', async () => {
        const { testEntitiesGetMany } = await adminClient.query(GET_ARRAY_LIST, {});
        const actualPrices = testEntitiesGetMany
            .sort(sortById)
            .map((x: any) => x.price)
            .sort((a: number, b: number) => a - b);
        const expectedPrices = [11, 9, 22, 14, 13, 33].sort((a, b) => a - b);
        expect(actualPrices).toEqual(expectedPrices);
    });

    // https://github.com/vendurehq/vendure/issues/1611
    describe('translations handling', () => {
        const allTranslations = [
            [
                { languageCode: LanguageCode.en, name: 'apple' },
                { languageCode: LanguageCode.de, name: 'apfel' },
            ],
            [
                { languageCode: LanguageCode.en, name: 'bike' },
                { languageCode: LanguageCode.de, name: 'fahrrad' },
            ],
        ];

        function getTestEntityTranslations(testEntities: { items: any[] }) {
            // Explicitly sort the order of the translations as it was being non-deterministic on
            // the mysql CI tests.
            return testEntities.items.map((e: any) =>
                e.translations.sort((a: any, b: any) => (a.languageCode < b.languageCode ? 1 : -1)),
            );
        }

        it('returns all translations with default languageCode', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TRANSLATIONS, {
                options: {
                    take: 2,
                    sort: {
                        order: SortOrder.ASC,
                    },
                },
            });

            const testEntityTranslations = getTestEntityTranslations(testEntities);
            expect(testEntities.items.map((e: any) => e.name)).toEqual(['apple', 'bike']);
            expect(testEntityTranslations).toEqual(allTranslations);
        });
        it('returns all translations with non-default languageCode', async () => {
            const { testEntities } = await shopClient.query(
                GET_LIST_WITH_TRANSLATIONS,
                {
                    options: {
                        take: 2,
                        sort: {
                            order: SortOrder.ASC,
                        },
                    },
                },
                { languageCode: LanguageCode.de },
            );

            const testEntityTranslations = getTestEntityTranslations(testEntities);
            expect(testEntities.items.map((e: any) => e.name)).toEqual(['apfel', 'fahrrad']);
            expect(testEntityTranslations).toEqual(allTranslations);
        });
    });

    describe('customPropertyMap', () => {
        it('filter by custom string field', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_ORDERS, {
                options: {
                    sort: {
                        label: SortOrder.ASC,
                    },
                    filter: {
                        customerLastName: { contains: 'zieme' },
                    },
                },
            });

            expect(testEntities.items).toEqual([
                {
                    id: 'T_1',
                    label: 'A',
                    name: 'apple',
                    parent: {
                        id: 'T_2',
                        label: 'B',
                        name: 'bike',
                    },
                    orderRelation: {
                        customer: {
                            firstName: 'Hayden',
                            lastName: 'Zieme',
                        },
                        id: 'T_1',
                    },
                },
                {
                    id: 'T_4',
                    label: 'D',
                    name: 'dog',
                    parent: {
                        id: 'T_2',
                        label: 'B',
                        name: 'bike',
                    },
                    orderRelation: {
                        customer: {
                            firstName: 'Hayden',
                            lastName: 'Zieme',
                        },
                        id: 'T_4',
                    },
                },
            ]);
        });

        it('sort by custom string field', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_ORDERS, {
                options: {
                    sort: {
                        customerLastName: SortOrder.ASC,
                    },
                },
            });

            expect(testEntities.items.map((i: any) => i.orderRelation.customer)).toEqual([
                { firstName: 'Trevor', lastName: 'Donnelly' },
                { firstName: 'Trevor', lastName: 'Donnelly' },
                { firstName: 'Marques', lastName: 'Sawayn' },
                { firstName: 'Marques', lastName: 'Sawayn' },
                { firstName: 'Hayden', lastName: 'Zieme' },
                { firstName: 'Hayden', lastName: 'Zieme' },
            ]);
        });
    });

    describe('relations in customFields', () => {
        it('should resolve relations in customFields successfully', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_CUSTOM_FIELD_RELATION, {
                options: {
                    filter: {
                        label: { eq: 'A' },
                    },
                },
            });

            expect(testEntities.items).toEqual([
                {
                    id: 'T_1',
                    label: 'A',
                    customFields: {
                        relation: [{ id: 'T_1', data: 'A' }],
                    },
                },
            ]);
        });

        it('should resolve multiple relations in customFields successfully', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_MULTIPLE_CUSTOM_FIELD_RELATION, {
                options: {
                    filter: {
                        label: { eq: 'A' },
                    },
                },
            });

            expect(testEntities.items).toEqual([
                {
                    id: 'T_1',
                    label: 'A',
                    customFields: {
                        relation: [{ id: 'T_1', data: 'A' }],
                        otherRelation: [{ id: 'T_1', data: 'A' }],
                    },
                },
            ]);
        });
    });

    // https://github.com/vendurehq/vendure/issues/3267
    describe('filtering with duplicate custom property fields in _and blocks', () => {
        it('filters by single tagId', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        tagId: { eq: 'T_1' }, // tag1
                    },
                },
            });

            // Entities with tag1: A, B, C, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'E']);
        });

        it('filters by multiple tagIds with _and (same field used twice)', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_2' } }], // tag1 AND tag2
                    },
                },
            });

            // Entities with BOTH tag1 AND tag2: A, B, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E']);
        });

        it('filters by three tagIds with _and (same field used three times)', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_2' } }, { tagId: { eq: 'T_3' } }], // tag1 AND tag2 AND tag3
                    },
                },
            });

            // Only entity E has all three tags
            expect(getItemLabels(testEntities.items)).toEqual(['E']);
        });

        it('filters by tagIds with _or (same field used twice)', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _or: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_2' } }], // tag1 OR tag2
                    },
                },
            });

            // Entities with tag1 OR tag2: A, B, C, D, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E']);
        });

        it('filters by tagId combined with other fields in _and', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_2' } }, { active: { eq: true } }],
                    },
                },
            });

            // Entities with tag1 AND tag2 AND active=true: A, B (E is not active)
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B']);
        });

        // ===== NESTED _and WITHIN _and =====

        it('filters with nested _and within _and (same field)', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [
                            { _and: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_2' } }] },
                            { tagId: { eq: 'T_3' } },
                        ],
                    },
                },
            });

            // (tag1 AND tag2) AND tag3 => Only E has all three
            expect(getItemLabels(testEntities.items)).toEqual(['E']);
        });

        it('filters with deeply nested _and (three levels)', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [
                            {
                                _and: [{ tagId: { eq: 'T_1' } }, { _and: [{ tagId: { eq: 'T_2' } }] }],
                            },
                        ],
                    },
                },
            });

            // Deeply nested: tag1 AND tag2 => A, B, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E']);
        });

        // ===== _and WITHIN _or =====

        it('filters with _and within _or (same field in inner _and)', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _or: [
                            { _and: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_2' } }] },
                            { label: { eq: 'F' } },
                        ],
                    },
                },
            });

            // (tag1 AND tag2) OR label='F' => A, B, E (have both tags) + F (by label)
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E', 'F']);
        });

        it('filters with multiple _and blocks within _or', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _or: [
                            { _and: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_3' } }] },
                            { _and: [{ tagId: { eq: 'T_2' } }, { active: { eq: true } }] },
                        ],
                    },
                },
            });

            // (tag1 AND tag3) => E only
            // OR (tag2 AND active) => A, B, D
            // Combined: A, B, D, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'D', 'E']);
        });

        // ===== _or WITHIN _and =====

        it('filters with _or within _and (same field in inner _or)', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [
                            { _or: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_2' } }] },
                            { active: { eq: true } },
                        ],
                    },
                },
            });

            // (tag1 OR tag2) AND active => A, B, D (C has tag1 but inactive, E has both but inactive)
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'D']);
        });

        it('filters with same field in both _or and _and at different levels', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [
                            { tagId: { eq: 'T_1' } },
                            { _or: [{ tagId: { eq: 'T_2' } }, { tagId: { eq: 'T_3' } }] },
                        ],
                    },
                },
            });

            // tag1 AND (tag2 OR tag3)
            // tag1: A, B, C, E
            // tag2 OR tag3: A, B, D, E
            // Intersection: A, B, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E']);
        });

        // ===== COMPLEX MIXED SCENARIOS =====

        it('filters with complex nested structure (_and containing _or containing _and)', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [
                            {
                                _or: [
                                    { _and: [{ tagId: { eq: 'T_1' } }, { tagId: { eq: 'T_3' } }] },
                                    { label: { eq: 'D' } },
                                ],
                            },
                            { active: { eq: false } },
                        ],
                    },
                },
            });

            // ((tag1 AND tag3) OR label='D') AND inactive
            // (tag1 AND tag3): E
            // label='D': D
            // Combined for OR: D, E
            // AND inactive: E only (D is active)
            expect(getItemLabels(testEntities.items)).toEqual(['E']);
        });

        it('filters with same field appearing at multiple nesting levels', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [
                            { tagId: { eq: 'T_1' } },
                            {
                                _and: [
                                    { tagId: { eq: 'T_2' } },
                                    { _or: [{ tagId: { eq: 'T_3' } }, { active: { eq: true } }] },
                                ],
                            },
                        ],
                    },
                },
            });

            // tag1 AND (tag2 AND (tag3 OR active))
            // tag1: A, B, C, E
            // tag2: A, B, D, E
            // tag3 OR active: E (tag3) + A, B, D (active) = A, B, D, E
            // tag1 AND tag2: A, B, E
            // tag1 AND tag2 AND (tag3 OR active): A, B, E (E has tag3, A and B are active)
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E']);
        });

        // ===== USING "in" OPERATOR WITH SAME FIELD =====

        it('filters with "in" operator combined with "eq" on same field', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [{ tagId: { in: ['T_1', 'T_2'] } }, { tagId: { eq: 'T_3' } }],
                    },
                },
            });

            // (tag1 or tag2) AND tag3 => Only E has tag3 and also has tag1 or tag2
            expect(getItemLabels(testEntities.items)).toEqual(['E']);
        });

        it('filters with multiple "in" operators on same field in _and', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [{ tagId: { in: ['T_1'] } }, { tagId: { in: ['T_2'] } }],
                    },
                },
            });

            // Must have tag1 AND must have tag2 => A, B, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'E']);
        });

        // ===== TOP-LEVEL SAME FIELD (regression test) =====

        it('handles same field at top level (outside _and/_or)', async () => {
            // This tests that a single use of a *-to-Many field still works correctly
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        tagId: { in: ['T_1', 'T_2'] },
                    },
                },
            });

            // Entities with tag1 OR tag2: A, B, C, D, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E']);
        });

        it('handles single tagId filter combined with top-level _and', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [{ tagId: { eq: 'T_3' } }, { active: { eq: false } }],
                    },
                },
            });

            // tag3 AND inactive => E only (only entity with tag3, and it's inactive)
            expect(getItemLabels(testEntities.items)).toEqual(['E']);
        });

        // ===== filterOperator: OR at root level =====

        it('respects filterOperator OR with duplicate tagId filters', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filterOperator: LogicalOperator.OR,
                    filter: {
                        tagId: { eq: 'T_3' },
                        label: { eq: 'F' },
                    },
                },
            });

            // tag3 OR label='F' => E (has tag3) + F (by label)
            expect(getItemLabels(testEntities.items)).toEqual(['E', 'F']);
        });

        // ===== EDGE CASES =====

        it('handles empty _and array gracefully', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [],
                    },
                },
            });

            // Empty _and should return all entities
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
        });

        it('handles _and with single condition on *-to-Many field', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [{ tagId: { eq: 'T_3' } }],
                    },
                },
            });

            // Single condition in _and: tag3 => E only
            expect(getItemLabels(testEntities.items)).toEqual(['E']);
        });

        it('handles notEq operator on *-to-Many field', async () => {
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        tagId: { notEq: 'T_3' },
                    },
                },
            });

            // Entities that have at least one tag that is NOT tag3
            // A (tag1, tag2), B (tag1, tag2), C (tag1), D (tag2), E (tag1, tag2, tag3 - has non-T_3 tags)
            // F has no tags, so no tag satisfies notEq
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'C', 'D', 'E']);
        });

        it('handles BETWEEN operator on *-to-Many field', async () => {
            // Tag priorities: tag1=10, tag2=20, tag3=30
            // Find entities with tags having priority between 15 and 25 (i.e., tag2 with priority 20)
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        tagPriority: { between: { start: 15, end: 25 } },
                    },
                },
            });

            // Entities with tag2 (priority 20): A, B, D, E
            expect(getItemLabels(testEntities.items)).toEqual(['A', 'B', 'D', 'E']);
        });

        it('handles BETWEEN with _and on *-to-Many field', async () => {
            // Find entities with tags having priority between 5 and 15 (tag1=10)
            // AND tags having priority between 25 and 35 (tag3=30)
            const { testEntities } = await shopClient.query(GET_LIST_WITH_TAGS, {
                options: {
                    sort: { label: SortOrder.ASC },
                    filter: {
                        _and: [
                            { tagPriority: { between: { start: 5, end: 15 } } },
                            { tagPriority: { between: { start: 25, end: 35 } } },
                        ],
                    },
                },
            });

            // Only E has both tag1 (priority 10) and tag3 (priority 30)
            expect(getItemLabels(testEntities.items)).toEqual(['E']);
        });
    });
});

const GET_LIST = gql`
    query GetTestEntities($options: TestEntityListOptions) {
        testEntities(options: $options) {
            totalItems
            items {
                id
                label
                name
                date
            }
        }
    }
`;

const GET_LIST_WITH_TRANSLATIONS = gql`
    query GetTestEntitiesWithTranslations($options: TestEntityListOptions) {
        testEntities(options: $options) {
            totalItems
            items {
                id
                label
                name
                date
                translations {
                    languageCode
                    name
                }
            }
        }
    }
`;

const GET_LIST_WITH_ORDERS = gql`
    query GetTestEntitiesWithTranslations($options: TestEntityListOptions) {
        testEntities(options: $options) {
            totalItems
            items {
                id
                label
                name
                parent {
                    id
                    label
                    name
                }
                orderRelation {
                    id
                    customer {
                        firstName
                        lastName
                    }
                }
            }
        }
    }
`;

const GET_ARRAY_LIST = gql`
    query GetTestEntitiesArray($options: TestEntityListOptions) {
        testEntitiesGetMany(options: $options) {
            id
            label
            name
            date
            price
        }
    }
`;

const GET_LIST_WITH_CUSTOM_FIELD_RELATION = gql`
    query GetTestWithCustomFieldRelation($options: TestEntityListOptions) {
        testEntities(options: $options) {
            items {
                id
                label
                customFields {
                    relation {
                        id
                        data
                    }
                }
            }
        }
    }
`;

const GET_LIST_WITH_MULTIPLE_CUSTOM_FIELD_RELATION = gql`
    query GetTestWithMultipleCustomFieldRelation($options: TestEntityListOptions) {
        testEntities(options: $options) {
            items {
                id
                label
                customFields {
                    relation {
                        id
                        data
                    }
                    otherRelation {
                        id
                        data
                    }
                }
            }
        }
    }
`;

const GET_LIST_WITH_TAGS = gql`
    query GetTestEntitiesWithTags($options: TestEntityListOptions) {
        testEntities(options: $options) {
            totalItems
            items {
                id
                label
                tags {
                    id
                    name
                }
            }
        }
    }
`;
