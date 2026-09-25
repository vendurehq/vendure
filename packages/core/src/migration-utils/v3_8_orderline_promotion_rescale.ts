/* eslint-disable no-console */
import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import { EntityMetadata, QueryRunner } from 'typeorm';

import { OrderHistoryEntry } from '../entity/history-entry/order-history-entry.entity';
import { OrderLine } from '../entity/order-line/order-line.entity';
import { OrderModification } from '../entity/order-modification/order-modification.entity';

interface CandidateRow {
    id: string | number;
    orderId: string | number;
    quantity: number;
    orderPlacedQuantity: number;
    adjustments: string | null;
}

interface ModificationRow {
    orderId: string | number;
    createdAt: Date | string;
}

interface CancellationHistoryRow {
    createdAt: Date | string;
    data: string | { lines?: Array<{ orderLineId: string | number; quantity: number }> };
}

interface CancellationEvent {
    createdAt: Date | string;
    quantity: number;
}

const UPDATE_CHUNK_SIZE = 100;
const AMBIGUOUS_BASIS = Symbol('AMBIGUOUS_BASIS');

/**
 * @description
 * Options for {@link rescaleOrderLinePromotionAdjustments}.
 */
export interface RescaleOrderLinePromotionAdjustmentsOptions {
    /**
     * @description
     * The quantity basis for each OrderLine whose cancellation and containing Order's latest
     * modification have the same timestamp. Use the current quantity when the modification
     * happened last, or the quantity before the later cancellation when the cancellation happened
     * last.
     */
    ambiguousOrderLineQuantityBases?: Readonly<Record<string, number>>;
}

function toTime(value: Date | string | null): number | null {
    if (value == null) {
        return null;
    }
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

/**
 * Returns the quantity that the row's stored `PROMOTION` amounts are scaled to, or `undefined`
 * if they are already scaled to the current quantity and must be left alone.
 *
 * `PROMOTION` amounts are rewritten in full whenever `OrderCalculator` runs, which is what
 * `OrderModifier.modifyOrder()` ends in for every line in the order. A pre-#5127
 * `cancelOrderByOrderLines()` is the only thing that reduced `quantity` without rewriting them,
 * so only a line whose most recent order-wide recalculation predates its cancellation is stale.
 */
function getStoredQuantityBasis(
    row: CandidateRow,
    modifications: ModificationRow[],
    cancellations: CancellationEvent[],
): number | typeof AMBIGUOUS_BASIS | undefined {
    if (modifications.length === 0) {
        // Never modified, so the whole reduction came from cancellations and the amounts are
        // still on the placement basis.
        return row.orderPlacedQuantity;
    }
    const modificationTimes = modifications.map(modification => toTime(modification.createdAt));
    const cancellationTimes = cancellations.map(cancellation => toTime(cancellation.createdAt));
    if (modificationTimes.some(time => time == null) || cancellationTimes.some(time => time == null)) {
        return AMBIGUOUS_BASIS;
    }
    const lastModifiedAt = Math.max(...(modificationTimes as number[]));
    if (cancellationTimes.includes(lastModifiedAt)) {
        return AMBIGUOUS_BASIS;
    }
    const quantityCancelledAfterModification = cancellations
        .filter((_cancellation, index) => (cancellationTimes[index] as number) > lastModifiedAt)
        .reduce((total, cancellation) => total + cancellation.quantity, 0);
    return quantityCancelledAfterModification > 0
        ? row.quantity + quantityCancelledAfterModification
        : undefined;
}

function parseCancellationLines(row: CancellationHistoryRow) {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    return Array.isArray(data?.lines) ? data.lines : [];
}

function getColumnName(metadata: EntityMetadata, propertyName: string): string {
    const column = metadata.findColumnWithPropertyName(propertyName);
    if (!column) {
        throw new Error(`Could not find ${metadata.name}.${propertyName} column metadata.`);
    }
    return column.databaseName;
}

function getRelationColumnName(metadata: EntityMetadata, propertyName: string): string {
    const column = metadata.findRelationWithPropertyPath(propertyName)?.joinColumns[0];
    if (!column) {
        throw new Error(`Could not find ${metadata.name}.${propertyName} relation column metadata.`);
    }
    return column.databaseName;
}

/**
 * @description
 * Rescales `PROMOTION`-type `Adjustment`s on `order_line` rows that were partially
 * cancelled by a pre-#5127 `cancelOrderByOrderLines()`, which reduced `quantity`
 * without rescaling `adjustments`. Reading those rows with the fixed `OrderLine`
 * getters (which divide a `PROMOTION` adjustment by the *current* `quantity`,
 * instead of `orderPlacedQuantity`) would otherwise inflate their discount.
 *
 * `OrderModifier.modifyOrder()` ends in `applyPriceAdjustments()`, which recomputes the
 * `PROMOTION` amounts for every line in the order, including lines not referenced by the
 * `OrderModification`. For a subsequently-cancelled line, the stored basis is its current
 * quantity plus the quantities in order-cancellation history after the order's latest
 * `OrderModification`.
 *
 * Some databases can store a modification and cancellation with the same timestamp. Their
 * order is then unknowable from persisted data, so the helper throws before writing anything.
 * Inspect those lines and pass `ambiguousOrderLineQuantityBases`: use the current quantity if
 * the modification happened last, or the quantity before cancellation if cancellation happened
 * last.
 *
 * Call this from your migration's `up()` method - it needs no schema change, so it
 * can run at any point in the migration.
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { rescaleOrderLinePromotionAdjustments } from '\@vendure/core';
 *
 * export class RescaleOrderLinePromotionAdjustments1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         await rescaleOrderLinePromotionAdjustments(queryRunner);
 *     }
 *
 *     public async down(queryRunner: QueryRunner): Promise<any> {
 *         // This is a one-way data migration - the pre-migration amounts are not recoverable.
 *     }
 * }
 * ```
 *
 * @since 3.8.0
 * @docsCategory migration
 */
export async function rescaleOrderLinePromotionAdjustments(
    queryRunner: QueryRunner,
    options: RescaleOrderLinePromotionAdjustmentsOptions = {},
): Promise<void> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const escTable = (tablePath: string) => tablePath.split('.').map(esc).join('.');
    const param = (index: number) => queryRunner.connection.driver.createParameter('p', index);
    const orderLineMetadata = queryRunner.connection.getMetadata(OrderLine);
    const modificationMetadata = queryRunner.connection.getMetadata(OrderModification);
    const historyMetadata = queryRunner.connection.getMetadata(OrderHistoryEntry);

    const orderLineTable = escTable(orderLineMetadata.tablePath);
    const orderLineId = esc(getColumnName(orderLineMetadata, 'id'));
    const orderLineOrderId = esc(getRelationColumnName(orderLineMetadata, 'order'));
    const orderLineQuantity = esc(getColumnName(orderLineMetadata, 'quantity'));
    const orderLinePlacedQuantity = esc(getColumnName(orderLineMetadata, 'orderPlacedQuantity'));
    const orderLineAdjustments = esc(getColumnName(orderLineMetadata, 'adjustments'));
    const modificationTable = escTable(modificationMetadata.tablePath);
    const modificationOrderId = esc(getRelationColumnName(modificationMetadata, 'order'));
    const modificationCreatedAt = esc(getColumnName(modificationMetadata, 'createdAt'));
    const historyTable = escTable(historyMetadata.tablePath);
    const historyOrderId = esc(getRelationColumnName(historyMetadata, 'order'));
    const historyCreatedAt = esc(getColumnName(historyMetadata, 'createdAt'));
    const historyData = esc(getColumnName(historyMetadata, 'data'));
    const historyType = esc(getColumnName(historyMetadata, 'type'));

    const rows: CandidateRow[] = await queryRunner.query(
        `SELECT ol.${orderLineId} AS ${esc('id')},
                ol.${orderLineOrderId} AS ${esc('orderId')},
                ol.${orderLineQuantity} AS ${esc('quantity')},
                ol.${orderLinePlacedQuantity} AS ${esc('orderPlacedQuantity')},
                ol.${orderLineAdjustments} AS ${esc('adjustments')}
         FROM ${orderLineTable} ol
         WHERE ol.${orderLineQuantity} < ol.${orderLinePlacedQuantity}
           AND ol.${orderLineQuantity} > 0
           AND ol.${orderLinePlacedQuantity} > 0`,
    );

    const modifications: ModificationRow[] = await queryRunner.query(
        `SELECT om.${modificationOrderId} AS ${esc('orderId')},
                om.${modificationCreatedAt} AS ${esc('createdAt')}
         FROM ${modificationTable} om
         WHERE EXISTS (
             SELECT 1 FROM ${orderLineTable} ol
             WHERE ol.${orderLineOrderId} = om.${modificationOrderId}
               AND ol.${orderLineQuantity} < ol.${orderLinePlacedQuantity}
               AND ol.${orderLineQuantity} > 0
               AND ol.${orderLinePlacedQuantity} > 0
         )`,
    );
    const cancellationHistory: CancellationHistoryRow[] = await queryRunner.query(
        `SELECT h.${historyCreatedAt} AS ${esc('createdAt')},
                h.${historyData} AS ${esc('data')}
         FROM ${historyTable} h
         WHERE h.${historyType} = ${param(0)}
           AND EXISTS (
               SELECT 1 FROM ${orderLineTable} ol
               WHERE ol.${orderLineOrderId} = h.${historyOrderId}
                 AND ol.${orderLineQuantity} < ol.${orderLinePlacedQuantity}
                 AND ol.${orderLineQuantity} > 0
                 AND ol.${orderLinePlacedQuantity} > 0
           )`,
        [HistoryEntryType.ORDER_CANCELLATION],
    );

    const modificationsByOrderId = new Map<string, ModificationRow[]>();
    for (const modification of modifications) {
        const orderId = String(modification.orderId);
        modificationsByOrderId.set(orderId, [...(modificationsByOrderId.get(orderId) ?? []), modification]);
    }
    const cancellationsByLineId = new Map<string, CancellationEvent[]>();
    for (const historyRow of cancellationHistory) {
        for (const line of parseCancellationLines(historyRow)) {
            const lineId = String(line.orderLineId);
            cancellationsByLineId.set(lineId, [
                ...(cancellationsByLineId.get(lineId) ?? []),
                { createdAt: historyRow.createdAt, quantity: Number(line.quantity) },
            ]);
        }
    }

    const updates: Array<{ id: string | number; adjustments: string }> = [];
    const unresolvedLineIds: Array<string | number> = [];
    for (const row of rows) {
        if (row.quantity <= 0 || !row.adjustments) {
            continue;
        }
        const adjustments = JSON.parse(row.adjustments);
        if (!Array.isArray(adjustments) || !adjustments.some((a: any) => a.type === 'PROMOTION')) {
            continue;
        }
        const lineId = String(row.id);
        const inferredBasis = getStoredQuantityBasis(
            row,
            modificationsByOrderId.get(String(row.orderId)) ?? [],
            cancellationsByLineId.get(lineId) ?? [],
        );
        let basis: number | undefined;
        if (inferredBasis === AMBIGUOUS_BASIS) {
            const configuredBasis = options.ambiguousOrderLineQuantityBases?.[lineId];
            if (configuredBasis == null) {
                unresolvedLineIds.push(row.id);
                continue;
            }
            if (!Number.isInteger(configuredBasis) || configuredBasis < row.quantity) {
                throw new Error(
                    `The configured quantity basis for OrderLine ${row.id} must be an integer greater than or equal to its current quantity (${row.quantity}).`,
                );
            }
            basis = configuredBasis;
        } else {
            basis = inferredBasis;
        }
        if (!basis || basis === row.quantity) {
            continue;
        }
        const scaleFactor = row.quantity / basis;
        const rescaledAdjustments = adjustments.map((adjustment: any) =>
            adjustment.type === 'PROMOTION'
                ? { ...adjustment, amount: Math.round(adjustment.amount * scaleFactor) }
                : adjustment,
        );
        updates.push({ id: row.id, adjustments: JSON.stringify(rescaledAdjustments) });
    }

    if (unresolvedLineIds.length > 0) {
        throw new Error(
            `Cannot safely determine the stored quantity basis for OrderLine IDs: ${unresolvedLineIds.join(', ')}. ` +
                'Pass ambiguousOrderLineQuantityBases for each listed ID before rerunning this migration.',
        );
    }

    for (let offset = 0; offset < updates.length; offset += UPDATE_CHUNK_SIZE) {
        const chunk = updates.slice(offset, offset + UPDATE_CHUNK_SIZE);
        const params: Array<string | number> = [];
        const whenClauses = chunk
            .map(update => {
                const idParam = param(params.push(update.id) - 1);
                const adjustmentsParam = param(params.push(update.adjustments) - 1);
                return `WHEN ${idParam} THEN ${adjustmentsParam}`;
            })
            .join(' ');
        const idParams = chunk.map(update => param(params.push(update.id) - 1)).join(', ');
        await queryRunner.query(
            `UPDATE ${orderLineTable}
             SET ${orderLineAdjustments} = CASE ${orderLineId} ${whenClauses} END
             WHERE ${orderLineId} IN (${idParams})`,
            params,
        );
    }

    console.log(`Rescaled PROMOTION adjustments on ${updates.length} partially-cancelled OrderLine row(s).`);
}
