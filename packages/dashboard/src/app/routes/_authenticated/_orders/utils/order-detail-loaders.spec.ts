import { addDetailQueryDocument } from '@/vdb/framework/form-engine/custom-form-component-extensions.js';
import { globalRegistry } from '@/vdb/framework/registry/global-registry.js';
import { QueryClient } from '@tanstack/react-query';
import { parse, print } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadModifyingOrder, loadRegularOrder, loadSellerOrder } from './order-detail-loaders.js';

const { query } = vi.hoisted(() => ({
    query: vi.fn(),
}));

vi.mock('@/vdb/graphql/api.js', () => ({
    api: { query },
}));

describe('loadRegularOrder', () => {
    beforeEach(() => {
        globalRegistry.get('detailQueryDocumentRegistry').clear();
        query.mockReset();
    });

    it('includes registered order detail query extensions in the preloaded query', async () => {
        addDetailQueryDocument(
            'order-detail',
            parse(`
                query GetOrder($id: ID!) {
                    order(id: $id) {
                        channels {
                            defaultLanguageCode
                        }
                    }
                }
            `),
        );
        query.mockResolvedValue({
            order: {
                code: 'T_1',
                state: 'PaymentSettled',
            },
        });
        const context = {
            queryClient: {
                ensureQueryData: vi.fn(options => options.queryFn()),
            },
        };

        await loadRegularOrder(context, { id: '1' });

        expect(print(query.mock.calls[0][0])).toContain('defaultLanguageCode');
    });

    it('includes registered seller order detail query extensions in the preloaded query', async () => {
        addDetailQueryDocument(
            'seller-order-detail',
            parse(`
                query GetOrder($id: ID!) {
                    order(id: $id) {
                        channels {
                            defaultLanguageCode
                        }
                    }
                }
            `),
        );
        query.mockResolvedValue({
            order: {
                aggregateOrder: {
                    code: 'T_1',
                    id: 'aggregate-order-1',
                },
                code: 'T_2',
                state: 'PaymentSettled',
            },
        });
        const context = {
            queryClient: {
                ensureQueryData: vi.fn(options => options.queryFn()),
            },
        };

        await loadSellerOrder(context, {
            aggregateOrderId: 'aggregate-order-1',
            sellerOrderId: 'seller-order-1',
        });

        expect(print(query.mock.calls[0][0])).toContain('defaultLanguageCode');
    });

    it('includes registered order modification query extensions in the preloaded query', async () => {
        addDetailQueryDocument(
            'order-modify',
            parse(`
                query GetOrder($id: ID!) {
                    order(id: $id) {
                        channels {
                            defaultLanguageCode
                        }
                    }
                }
            `),
        );
        query.mockResolvedValue({
            order: {
                code: 'T_1',
                state: 'Modifying',
            },
        });
        const context = {
            queryClient: new QueryClient(),
        };

        await loadModifyingOrder(context, { id: '1' });

        expect(print(query.mock.calls[0][0])).toContain('defaultLanguageCode');
    });

    it('does not reuse an incompatible order detail preload after redirecting to modification', async () => {
        addDetailQueryDocument(
            'order-detail',
            parse(`
                query GetOrder($id: ID!) {
                    order(id: $id) {
                        channels {
                            code
                        }
                    }
                }
            `),
        );
        addDetailQueryDocument(
            'order-modify',
            parse(`
                query GetOrder($id: ID!) {
                    order(id: $id) {
                        channels {
                            defaultLanguageCode
                        }
                    }
                }
            `),
        );
        query.mockResolvedValue({
            order: {
                code: 'T_1',
                state: 'Modifying',
            },
        });
        const context = {
            queryClient: new QueryClient(),
        };

        await expect(loadRegularOrder(context, { id: '1' })).rejects.toBeDefined();
        await loadModifyingOrder(context, { id: '1' });

        expect(query).toHaveBeenCalledTimes(2);
        expect(print(query.mock.calls[1][0])).toContain('defaultLanguageCode');
    });
});
