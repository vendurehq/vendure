import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError } from '../../../common/error/errors';
import { roundMoney } from '../../../common/round-money';
import { PriceCalculationResult } from '../../../common/types/common-types';
import { ChangedPriceHandlingStrategy } from '../../../config/order/changed-price-handling-strategy';
import {
    LinePriceCalculationInput,
    OrderItemPriceCalculationStrategy,
} from '../../../config/order/order-item-price-calculation-strategy';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';

/**
 * @description
 * Prices the given OrderLines. The lines that `calculateLinePrices` quotes are priced from their
 * quote, with a single call for all of them. The others are priced by `calculateUnitPrice`.
 */
export async function setOrderLinePrices(
    ctx: RequestContext,
    strategy: OrderItemPriceCalculationStrategy,
    order: Order,
    entries: Array<{ line: OrderLine; variant: ProductVariant }>,
    changedPriceHandling?: ChangedPriceHandlingStrategy,
): Promise<void> {
    // A fully cancelled line keeps the price used for refunds.
    const toPrice = entries.filter(({ line }) => !(line.quantity === 0 && line.quotedLinePrice != null));
    const quotable = toPrice.filter(({ line }) => line.quantity > 0);
    const quotes = new Map<OrderLine, PriceCalculationResult>();
    if (strategy.calculateLinePrices && quotable.length) {
        const inputs: LinePriceCalculationInput[] = quotable.map(({ line, variant }) => ({
            orderLine: line,
            productVariant: variant,
            orderLineCustomFields: line.customFields || {},
            quantity: line.quantity,
        }));
        const results = await strategy.calculateLinePrices(ctx, order, inputs);
        if (!Array.isArray(results) || results.length !== inputs.length) {
            throw new InternalServerError(
                'calculateLinePrices must return one result, or undefined, for each line it is given',
            );
        }
        results.forEach((quote, i) => {
            if (quote == null) {
                return;
            }
            if (!Number.isSafeInteger(quote.price) || quote.price < 0) {
                throw new InternalServerError('calculateLinePrices must return non-negative integer prices');
            }
            quotes.set(quotable[i].line, quote);
        });
    }
    for (const { line, variant } of toPrice) {
        await applyPrice(ctx, strategy, order, line, variant, quotes.get(line), changedPriceHandling);
    }
}

async function applyPrice(
    ctx: RequestContext,
    strategy: OrderItemPriceCalculationStrategy,
    order: Order,
    line: OrderLine,
    variant: ProductVariant,
    quote: PriceCalculationResult | undefined,
    changedPriceHandling?: ChangedPriceHandlingStrategy,
) {
    const calculated = quote
        ? { price: roundMoney(quote.price / line.quantity), priceIncludesTax: quote.priceIncludesTax }
        : await strategy.calculateUnitPrice(ctx, variant, line.customFields || {}, order, line.quantity);
    const unitPrice = calculated.price;
    let price = calculated;
    if (changedPriceHandling) {
        const initialPrice = line.initialListPrice ?? calculated.price;
        if (initialPrice !== calculated.price) {
            price = await changedPriceHandling.handlePriceChange(ctx, calculated, line, order);
        }
        line.initialListPrice ??= initialPrice;
    }
    line.listPrice = price.price;
    line.listPriceIncludesTax = price.priceIncludesTax;
    const keepQuote = quote && price.price === unitPrice && price.priceIncludesTax === quote.priceIncludesTax;
    line.quotedLinePrice = keepQuote ? quote.price : null;
    line.quotedQuantity = keepQuote ? line.quantity : null;
}
