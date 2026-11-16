import { QueryRunner } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rescaleOrderLinePromotionAdjustments } from './v3_8_orderline_promotion_rescale';

interface Row {
    id: number;
    orderId?: number;
    quantity: number;
    orderPlacedQuantity: number;
    adjustments: string | null;
}

interface ModificationRow {
    orderId: number;
    createdAt: string;
}

interface CancellationRow {
    createdAt: string;
    data: string;
}

interface ExecutedQuery {
    sql: string;
    params: any[];
}

interface MetadataNames {
    tablePath: string;
    columns: Record<string, string>;
    relations?: Record<string, string>;
}

const defaultMetadata: Record<string, MetadataNames> = {
    OrderLine: {
        tablePath: 'order_line',
        columns: {
            id: 'id',
            quantity: 'quantity',
            orderPlacedQuantity: 'orderPlacedQuantity',
            adjustments: 'adjustments',
        },
        relations: { order: 'orderId' },
    },
    OrderModification: {
        tablePath: 'order_modification',
        columns: { createdAt: 'createdAt' },
        relations: { order: 'orderId' },
    },
    OrderHistoryEntry: {
        tablePath: 'history_entry',
        columns: { createdAt: 'createdAt', type: 'type', data: 'data' },
        relations: { order: 'orderId' },
    },
};

function promotion(amount: number) {
    return { adjustmentSource: 'PROMOTION:1', type: 'PROMOTION', description: '50% off', amount, data: {} };
}

function distributed(amount: number) {
    return {
        adjustmentSource: 'PROMOTION:2',
        type: 'DISTRIBUTED_ORDER_PROMOTION',
        description: '£5 off order',
        amount,
        data: {},
    };
}

function createQueryRunner(
    rows: Row[],
    history: { modifications?: ModificationRow[]; cancellations?: CancellationRow[] } = {},
    metadataOverrides: Partial<Record<string, MetadataNames>> = {},
) {
    const executed: ExecutedQuery[] = [];
    const selectResults = [
        rows.map(row => ({ orderId: 1, ...row })),
        history.modifications ?? [],
        history.cancellations ?? [],
    ];
    let selectIndex = 0;
    const metadata = { ...defaultMetadata, ...metadataOverrides };
    const queryRunner = {
        connection: {
            driver: {
                escape: (name: string) => `"${name}"`,
                createParameter: (_name: string, index: number) => `$${index + 1}`,
            },
            getMetadata: (target: { name: string }) => {
                const names = metadata[target.name];
                if (!names) {
                    throw new Error(`Missing metadata for ${target.name}`);
                }
                return {
                    tablePath: names.tablePath,
                    findColumnWithPropertyName: (propertyName: string) => {
                        const databaseName = names.columns[propertyName];
                        return databaseName ? { databaseName } : undefined;
                    },
                    findRelationWithPropertyPath: (propertyPath: string) => {
                        const databaseName = names.relations?.[propertyPath];
                        return databaseName ? { joinColumns: [{ databaseName }] } : undefined;
                    },
                };
            },
        },
        query: vi.fn((sql: string, params: any[] = []) => {
            executed.push({ sql, params });
            if (sql.trim().startsWith('SELECT')) {
                return Promise.resolve(selectResults[selectIndex++]);
            }
            return Promise.resolve([]);
        }),
    } as unknown as QueryRunner;
    return { queryRunner, executed };
}

function updatesFrom(executed: ExecutedQuery[]) {
    return executed.filter(q => q.sql.trim().startsWith('UPDATE'));
}

/**
 * Reads back the adjustments the migration would have written for the given order_line id, by
 * pairing up the parameters of the `CASE "id" WHEN ? THEN ?` update.
 */
function writtenAdjustmentsFor(executed: ExecutedQuery[], id: number): any[] | undefined {
    for (const query of updatesFrom(executed)) {
        const whenCount = (query.sql.match(/WHEN/g) ?? []).length;
        for (let i = 0; i < whenCount; i++) {
            if (query.params[i * 2] === id) {
                return JSON.parse(query.params[i * 2 + 1]);
            }
        }
    }
    return undefined;
}

describe('rescaleOrderLinePromotionAdjustments()', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('rescales a partially-cancelled line to its current quantity', async () => {
        // 20 units at 2975 with a 50% item promotion, 18 units cancelled by pre-#5127 code.
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 2,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-29750)]),
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(writtenAdjustmentsFor(executed, 1)).toEqual([promotion(-2975)]);
    });

    it('leaves non-PROMOTION adjustments untouched', async () => {
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 2,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-29750), distributed(-500)]),
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(writtenAdjustmentsFor(executed, 1)).toEqual([promotion(-2975), distributed(-500)]);
    });

    it('leaves fully-cancelled lines untouched', async () => {
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 0,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-29750)]),
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('leaves a line reduced by an OrderModification untouched', async () => {
        // modifyOrder() ends in applyPriceAdjustments(), so -2975 is already the correct amount
        // for the 2 remaining units. Rescaling it again would give -297.
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    quantity: 2,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-2975)]),
                },
            ],
            {
                modifications: [{ orderId: 1, createdAt: '2026-01-02T00:00:00.000Z' }],
            },
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it("leaves a cancelled line alone when another line's later modification recalculated the order", async () => {
        // B was cancelled first. Reducing A in modifyOrder records A's cancellation before the
        // order-level modification, whose promotion pass then rewrites both lines.
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    orderId: 42,
                    quantity: 10,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-10000)]),
                },
                {
                    id: 2,
                    orderId: 42,
                    quantity: 10,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-10000)]),
                },
            ],
            {
                modifications: [{ orderId: 42, createdAt: '2026-01-03T00:00:00.000Z' }],
                cancellations: [
                    {
                        createdAt: '2026-01-01T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 2, quantity: 10 }] }),
                    },
                    {
                        createdAt: '2026-01-02T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 1, quantity: 10 }] }),
                    },
                ],
            },
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('leaves a line untouched when the modification is more recent than the cancellation', async () => {
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    quantity: 8,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-11900)]),
                },
            ],
            {
                modifications: [{ orderId: 1, createdAt: '2026-01-03T00:00:00.000Z' }],
                cancellations: [
                    {
                        createdAt: '2026-01-02T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 1, quantity: 10 }] }),
                    },
                ],
            },
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('rejects an ambiguous equal-timestamp history before writing', async () => {
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    quantity: 8,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-11900)]),
                },
            ],
            {
                modifications: [{ orderId: 1, createdAt: '2026-01-02T00:00:00.000Z' }],
                cancellations: [
                    {
                        createdAt: '2026-01-02T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 1, quantity: 2 }] }),
                    },
                ],
            },
        );

        await expect(rescaleOrderLinePromotionAdjustments(queryRunner)).rejects.toThrow(
            'Cannot safely determine the stored quantity basis for OrderLine IDs: 1',
        );

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('accepts an explicit current-quantity basis for an equal-timestamp modify-after-cancel line', async () => {
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    quantity: 8,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-8000)]),
                },
            ],
            {
                modifications: [{ orderId: 1, createdAt: '2026-01-02T00:00:00.000Z' }],
                cancellations: [
                    {
                        createdAt: '2026-01-02T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 1, quantity: 2 }] }),
                    },
                ],
            },
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner, {
            ambiguousOrderLineQuantityBases: { 1: 8 },
        });

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('accepts an explicit pre-cancellation basis for an equal-timestamp cancel-after-modify line', async () => {
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    quantity: 8,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-10000)]),
                },
            ],
            {
                modifications: [{ orderId: 1, createdAt: '2026-01-02T00:00:00.000Z' }],
                cancellations: [
                    {
                        createdAt: '2026-01-02T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 1, quantity: 2 }] }),
                    },
                ],
            },
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner, {
            ambiguousOrderLineQuantityBases: { 1: 10 },
        });

        expect(writtenAdjustmentsFor(executed, 1)).toEqual([promotion(-8000)]);
    });

    it('rescales a modified-then-cancelled line from its post-modification quantity', async () => {
        // Placed at 20, modified down to 10 (which rewrote the amount to -14875), then 8 units
        // cancelled. The basis is 10, not the placement quantity of 20.
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    quantity: 2,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-14875)]),
                },
            ],
            {
                modifications: [{ orderId: 1, createdAt: '2026-01-02T00:00:00.000Z' }],
                cancellations: [
                    {
                        createdAt: '2026-01-03T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 1, quantity: 8 }] }),
                    },
                ],
            },
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(writtenAdjustmentsFor(executed, 1)).toEqual([promotion(-2975)]);
    });

    it('uses the latest modification basis after earlier and later standalone cancellations', async () => {
        // Placed at 20, cancelled to 15, modified to 10, then cancelled to 5. The latest
        // modification rewrote the amount on a basis of 10; summing its -5 delta from placement
        // would incorrectly produce a basis of 15 by ignoring the first standalone cancellation.
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    quantity: 5,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-10000)]),
                },
            ],
            {
                modifications: [{ orderId: 1, createdAt: '2026-01-02T00:00:00.000Z' }],
                cancellations: [
                    {
                        createdAt: '2026-01-01T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 1, quantity: 5 }] }),
                    },
                    {
                        createdAt: '2026-01-03T00:00:00.000Z',
                        data: JSON.stringify({ lines: [{ orderLineId: 1, quantity: 5 }] }),
                    },
                ],
            },
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(writtenAdjustmentsFor(executed, 1)).toEqual([promotion(-5000)]);
    });

    it('skips lines with no PROMOTION adjustment', async () => {
        const { queryRunner, executed } = createQueryRunner([
            { id: 1, quantity: 2, orderPlacedQuantity: 20, adjustments: JSON.stringify([distributed(-500)]) },
            { id: 2, quantity: 2, orderPlacedQuantity: 20, adjustments: null },
            { id: 3, quantity: 2, orderPlacedQuantity: 20, adjustments: JSON.stringify([]) },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('passes values as bound parameters rather than SQL literals', async () => {
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 2,
                orderPlacedQuantity: 20,
                // A description carrying a quote and a backslash, which literal-escaping mangles.
                adjustments: JSON.stringify([{ ...promotion(-29750), description: `Bob's 50\\% off` }]),
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        const [update] = updatesFrom(executed);
        expect(update.sql).not.toContain('Bob');
        expect(update.sql).not.toContain('-2975');
        expect(update.params[0]).toBe(1);
        expect(JSON.parse(update.params[1])[0].description).toBe(`Bob's 50\\% off`);
    });

    it('uses entity metadata for schema-qualified table paths and physical column names', async () => {
        const { queryRunner, executed } = createQueryRunner(
            [
                {
                    id: 1,
                    quantity: 2,
                    orderPlacedQuantity: 20,
                    adjustments: JSON.stringify([promotion(-29750)]),
                },
            ],
            {},
            {
                OrderLine: {
                    tablePath: 'tenant.pref_order_lines',
                    columns: {
                        id: 'line_pk',
                        quantity: 'current_qty',
                        orderPlacedQuantity: 'placed_qty',
                        adjustments: 'price_adjustments',
                    },
                    relations: { order: 'order_fk' },
                },
                OrderModification: {
                    tablePath: 'tenant.pref_modifications',
                    columns: { createdAt: 'created_on' },
                    relations: { order: 'modification_order_fk' },
                },
                OrderHistoryEntry: {
                    tablePath: 'tenant.pref_history',
                    columns: { createdAt: 'created_on', type: 'event_type', data: 'payload' },
                    relations: { order: 'order_fk' },
                },
            },
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        const sql = executed.map(query => query.sql).join('\n');
        expect(sql).toContain('"tenant"."pref_order_lines"');
        expect(sql).toContain('"tenant"."pref_modifications"');
        expect(sql).toContain('"tenant"."pref_history"');
        for (const name of [
            'line_pk',
            'current_qty',
            'placed_qty',
            'price_adjustments',
            'order_fk',
            'modification_order_fk',
            'created_on',
            'event_type',
            'payload',
        ]) {
            expect(sql).toContain(`"${name}"`);
        }
        expect(sql).not.toContain('"order_line"');
    });

    it('updates all affected rows in a single statement', async () => {
        const { queryRunner, executed } = createQueryRunner(
            [1, 2, 3].map(id => ({
                id,
                quantity: 2,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-29750)]),
            })),
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed).length).toBe(1);
        for (const id of [1, 2, 3]) {
            expect(writtenAdjustmentsFor(executed, id)).toEqual([promotion(-2975)]);
        }
    });
});
