import {
    EntityHydrator,
    Injector,
    LanguageCode,
    Order,
    OrderInterceptor,
    ProductVariant,
    RequestContext,
    TranslatorService,
    VendurePlugin,
    WillAddItemToOrderInput,
    WillAdjustOrderLineInput,
} from '@vendure/core';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductVariantFields {
        minOrderQuantity?: number;
        maxOrderQuantity?: number;
    }
}

/**
 * This OrderInterceptor enforces minimum and maximum order quantities on ProductVariants.
 */
export class MinMaxOrderInterceptor implements OrderInterceptor {
    private entityHydrator: EntityHydrator;
    private translatorService: TranslatorService;

    init(injector: Injector) {
        this.entityHydrator = injector.get(EntityHydrator);
        this.translatorService = injector.get(TranslatorService);
    }

    willAddItemToOrder(
        ctx: RequestContext,
        order: Order,
        input: WillAddItemToOrderInput,
    ): Promise<void | string> | void | string {
        const { productVariant, quantity } = input;
        const min = productVariant.customFields?.minOrderQuantity;
        const max = productVariant.customFields?.maxOrderQuantity;
        if (min && quantity < min) {
            return this.minErrorMessage(ctx, productVariant, min);
        }
        if (max && quantity > max) {
            return this.maxErrorMessage(ctx, productVariant, max);
        }
    }

    willAdjustOrderLine(
        ctx: RequestContext,
        order: Order,
        input: WillAdjustOrderLineInput,
    ): Promise<void | string> | void | string {
        const { orderLine, quantity } = input;
        const min = orderLine.productVariant.customFields?.minOrderQuantity;
        const max = orderLine.productVariant.customFields?.maxOrderQuantity;
        if (min && quantity < min) {
            return this.minErrorMessage(ctx, orderLine.productVariant, min);
        }
        if (max && quantity > max) {
            return this.maxErrorMessage(ctx, orderLine.productVariant, max);
        }
    }

    private async minErrorMessage(ctx: RequestContext, variant: ProductVariant, min: number) {
        const variantName = await this.getTranslatedVariantName(ctx, variant);
        return `Minimum order quantity for "${variantName}" is ${min}`;
    }

    private async maxErrorMessage(ctx: RequestContext, variant: ProductVariant, max: number) {
        const variantName = await this.getTranslatedVariantName(ctx, variant);
        return `Maximum order quantity for "${variantName}" is ${max}`;
    }

    private async getTranslatedVariantName(ctx: RequestContext, variant: ProductVariant) {
        await this.entityHydrator.hydrate(ctx, variant, { relations: ['translations'] });
        const translated = this.translatorService.translate(variant, ctx);
        return translated.name;
    }
}

/**
 * This plugin enforces minimum and maximum order quantities on ProductVariants.
 * It adds two new custom fields to ProductVariant:
 * - minOrderQuantity
 * - maxOrderQuantity
 *
 * It also adds an OrderInterceptor which enforces these limits.
 */
@VendurePlugin({
    configuration: config => {
        config.customFields.ProductVariant.push({
            type: 'int',
            min: 0,
            name: 'minOrderQuantity',
            label: [{ languageCode: LanguageCode.en, value: 'Minimum order quantity' }],
            nullable: true,
        });
        config.customFields.ProductVariant.push({
            type: 'int',
            min: 0,
            name: 'maxOrderQuantity',
            label: [{ languageCode: LanguageCode.en, value: 'Maximum order quantity' }],
            nullable: true,
        });
        config.orderOptions.orderInterceptors.push(new MinMaxOrderInterceptor());
        return config;
    },
})
export class OrderQuantityLimitsPlugin {}
