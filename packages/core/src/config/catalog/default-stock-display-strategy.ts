import { RequestContext } from '../../api/common/request-context';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

import { StockDisplayStrategy } from './stock-display-strategy';

/**
 * @description
 * Displays the `ProductVariant.stockLevel` as either `'IN_STOCK'`, `'OUT_OF_STOCK'` or `'LOW_STOCK'`.
 * Low stock is defined as a saleable stock level less than or equal to the `lowStockLevel` as passed in
 * to the constructor (defaults to `2`).
 *
 * @docsCategory products & stock
 */
export class DefaultStockDisplayStrategy implements StockDisplayStrategy {
    constructor(private lowStockLevel: number = 2) {}
    getStockLevel(ctx: RequestContext, productVariant: ProductVariant, saleableStockLevel: number): string {
        return saleableStockLevel < 1
            ? 'OUT_OF_STOCK'
            : saleableStockLevel <= this.lowStockLevel
            ? 'LOW_STOCK'
            : 'IN_STOCK';
    }
}
