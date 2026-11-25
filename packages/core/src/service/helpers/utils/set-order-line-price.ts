import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError } from '../../../common/error/errors';
import { roundMoney } from '../../../common/round-money';
import { ChangedPriceHandlingStrategy } from '../../../config/order/changed-price-handling-strategy';
import { OrderItemPriceCalculationStrategy } from '../../../config/order/order-item-price-calculation-strategy';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';

export async function setOrderLinePrice(
    ctx: RequestContext,
    strategy: OrderItemPriceCalculationStrategy,
    variant: ProductVariant,
    order: Order,
    line: OrderLine,
    changedPriceHandling?: ChangedPriceHandlingStrategy,
): Promise<void> {
    if (line.quantity === 0 && line.quotedLinePrice != null) {
        // A fully cancelled line keeps the price used for refunds.
        return;
    }
    const fields = line.customFields || {};
    const quote =
        line.quantity > 0
            ? await strategy.calculateLinePrice?.(ctx, variant, fields, order, line.quantity)
            : undefined;
    if (quote && (!Number.isSafeInteger(quote.price) || quote.price < 0)) {
        throw new InternalServerError('calculateLinePrice must return a non-negative integer price');
    }
    const calculated = quote
        ? { price: roundMoney(quote.price / line.quantity), priceIncludesTax: quote.priceIncludesTax }
        : await strategy.calculateUnitPrice(ctx, variant, fields, order, line.quantity);
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
