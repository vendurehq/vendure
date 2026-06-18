import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { PromotionCondition } from '../promotion-condition';

export const buyXGetYFreeCondition = new PromotionCondition({
    code: 'buy_x_get_y_free',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Buy X products, get Y products free',
        },
    ],
    args: {
        amountX: {
            type: 'int',
            defaultValue: 2,
            ui: { component: '', min: 0 },
        },
        variantIdsX: {
            type: 'ID',
            list: true,
            ui: { component: 'product-selector-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Buy amountX of these variants' }],
        },
        amountY: {
            type: 'int',
            defaultValue: 1,
            ui: { component: '', min: 0 },
        },
        variantIdsY: {
            type: 'ID',
            list: true,
            ui: { component: 'product-selector-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Get amountY of these variants for free' }],
        },
    },
    async check(ctx, order, args) {
        const xIds = createIdentityMap(args.variantIdsX);
        const yIds = createIdentityMap(args.variantIdsY);
        let matches = 0;
        const freeItemCandidates: OrderLine[] = [];
        for (const line of order.lines) {
            const variantId = line.productVariant.id;
            if (variantId in xIds) {
                matches += line.quantity;
            }
            if (variantId in yIds) {
                freeItemCandidates.push(line);
            }
        }
        const quantity = Math.floor(matches / args.amountX);
        if (!quantity || !freeItemCandidates.length) return false;
        const freeLines = freeItemCandidates.sort((a, b) => {
            const unitPriceA = ctx.channel.pricesIncludeTax ? a.unitPriceWithTax : a.unitPrice;
            const unitPriceB = ctx.channel.pricesIncludeTax ? b.unitPriceWithTax : b.unitPrice;
            if (unitPriceA < unitPriceB) return -1;
            if (unitPriceA > unitPriceB) return 1;
            return 0;
        });
        let placesToAllocate = args.amountY;
        const freeItemsPerLine: { [lineId: string]: number } = {};
        for (const freeLine of freeLines) {
            if (placesToAllocate === 0) break;
            const freeQuantity = Math.min(freeLine.quantity, placesToAllocate);
            freeItemsPerLine[freeLine.id] = freeQuantity;
            placesToAllocate -= freeQuantity;
        }
        return { freeItemsPerLine };
    },
});

function createIdentityMap(ids: ID[]): Record<ID, ID> {
    return ids.reduce((map: Record<ID, ID>, id) => ({ ...map, [id]: id }), {});
}
