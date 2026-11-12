import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { FindOptionsWhere } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Allocation } from '../../../entity/stock-movement/allocation.entity';
import { Cancellation } from '../../../entity/stock-movement/cancellation.entity';
import { Release } from '../../../entity/stock-movement/release.entity';
import { Sale } from '../../../entity/stock-movement/sale.entity';
import { StockMovement } from '../../../entity/stock-movement/stock-movement.entity';

/**
 * @description
 * What is still outstanding for an OrderLine at one StockLocation, split by whether it is
 * tracked inventory.
 *
 * @since 4.0.0
 */
export interface OutstandingStock {
    tracked: number;
    untracked: number;
}

/**
 * @description
 * The stock movements of one OrderLine (Allocations, Releases, Sales, Cancellations), read
 * once, from which the outstanding quantities per StockLocation are derived:
 *
 * - `allocated`: Allocations minus Releases minus Sales. What a Release or Sale can consume.
 * - `sold`: Sales minus Cancellations, never more than was allocated at that location. What a
 *   Cancellation can put back. The cap matters for Sales recorded before v4.0 on a line split
 *   across locations, which carry the whole line quantity at each location.
 *
 * Each figure is split by the `tracked` state recorded on the movements. Movements with
 * `tracked = null` (recorded before v4.0 and not backfilled) count as tracked if the caller says
 * the location is tracked now, which is what the pre-v4 code assumed.
 *
 * Used both by the StockLocationStrategy (to pick locations) and by the StockMovementService (to
 * decide what each movement changes), so that the two cannot disagree.
 *
 * @since 4.0.0
 */
export class OrderLineStockLedger {
    private constructor(
        private readonly allocations: Allocation[],
        private readonly releases: Release[],
        private readonly sales: Sale[],
        private readonly cancellations: Cancellation[],
    ) {}

    static async load(
        ctx: RequestContext,
        connection: TransactionalConnection,
        orderLineId: ID,
    ): Promise<OrderLineStockLedger> {
        const where: FindOptionsWhere<Allocation> = { orderLine: { id: orderLineId } };
        const order = { id: 'ASC' } as const;
        // Sequential rather than Promise.all: one connection per transaction.
        const allocations = await connection.getRepository(ctx, Allocation).find({ where, order });
        const releases = await connection
            .getRepository(ctx, Release)
            .find({ where: where as FindOptionsWhere<Release> });
        const sales = await connection
            .getRepository(ctx, Sale)
            .find({ where: where as FindOptionsWhere<Sale>, order });
        const cancellations = await connection
            .getRepository(ctx, Cancellation)
            .find({ where: where as FindOptionsWhere<Cancellation> });
        return new OrderLineStockLedger(allocations, releases, sales, cancellations);
    }

    /** Whether the line has any movement at all. */
    get isEmpty(): boolean {
        return !this.allocations.length && !this.sales.length;
    }

    /**
     * The locations the line used, in the order it first used them: by Allocation for
     * `allocated`, by Sale for `sold`.
     */
    locationIds(mode: 'allocated' | 'sold'): string[] {
        const rows = mode === 'allocated' ? this.allocations : this.sales;
        return unique(rows.map(row => String(row.stockLocationId)));
    }

    /** Whether any movement at the location has `tracked = null`. */
    hasLegacyRows(stockLocationId: ID): boolean {
        return [...this.allocations, ...this.releases, ...this.sales, ...this.cancellations].some(
            row => String(row.stockLocationId) === String(stockLocationId) && row.tracked == null,
        );
    }

    outstanding(stockLocationId: ID, mode: 'allocated' | 'sold', legacyTracked = false): OutstandingStock {
        const sum = (rows: StockMovement[], tracked: boolean) =>
            rows
                .filter(row => String(row.stockLocationId) === String(stockLocationId))
                .filter(row => (row.tracked ?? legacyTracked) === tracked)
                .reduce((total, row) => total + Math.abs(row.quantity), 0);
        const part = (tracked: boolean) => {
            const allocated = sum(this.allocations, tracked);
            const sold = sum(this.sales, tracked);
            const value =
                mode === 'allocated'
                    ? allocated - sum(this.releases, tracked) - sold
                    : Math.min(sold, allocated) - sum(this.cancellations, tracked);
            return Math.max(0, value);
        };
        return { tracked: part(true), untracked: part(false) };
    }
}
