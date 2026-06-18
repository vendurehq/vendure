import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { idsAreEqual } from '../../../common/utils';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { PromotionItemAction } from '../promotion-action';

export const productsPercentageDiscount = new PromotionItemAction({
    code: 'products_percentage_discount',
    description: [{ languageCode: LanguageCode.en, value: 'Discount specified products by { discount }%' }],
    args: {
        discount: {
            type: 'float',
            ui: {
                component: 'number-form-input',
                suffix: '%',
                min: 0,
            },
        },
        productVariantIds: {
            type: 'ID',
            list: true,
            ui: { component: 'product-selector-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Product variants' }],
        },
    },
    execute(ctx, orderLine, args) {
        if (lineContainsIds(args.productVariantIds, orderLine)) {
            const unitPrice = ctx.channel.pricesIncludeTax ? orderLine.unitPriceWithTax : orderLine.unitPrice;
            return -unitPrice * (args.discount / 100);
        }
        return 0;
    },
});

function lineContainsIds(ids: ID[], line: OrderLine): boolean {
    return !!ids.find(id => idsAreEqual(id, line.productVariant.id));
}
