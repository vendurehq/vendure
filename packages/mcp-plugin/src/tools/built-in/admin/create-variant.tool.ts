import { Injectable } from '@nestjs/common';
import {
    Permission,
    ProductService,
    ProductVariantService,
    RequestContext,
    StockLevelService,
    UserInputError,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCustomFieldInputService } from '../custom-field-input.service';
import { idSchema } from '../id-schema';
import { int32Schema } from '../int32-schema';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

import { variantFieldsSchema } from './entity-field-schemas';
import { variantTranslationSchema } from './translation-schemas';

const createVariantInputSchema = variantFieldsSchema.extend({
    sku: shortText.describe('Stock keeping unit.'),
    translations: z.array(variantTranslationSchema).describe('Localized variant content.'),
    stockOnHand: int32Schema.describe('Initial stock on hand.').optional(),
});

const createVariantInput = z.strictObject({
    productId: idSchema.describe('Parent product ID.'),
    input: createVariantInputSchema,
});

type CreateVariantToolInput = z.infer<typeof createVariantInput>;

@McpTool({
    name: 'create_variant',
    toolset: 'admin',
    description:
        'Create a new variant of an existing product (e.g. a size or color option), with its SKU, price and stock.',
    keywords: [
        'add a size or color option',
        'create a new sku',
        'add a variant to a product',
        'make another version of an item',
        'new product option',
        'add a variation',
    ],
    permissions: [Permission.UpdateProduct],
    behavior: 'mutating',
    inputSchema: createVariantInput,
})
@Injectable()
export class CreateVariantTool implements McpToolHandler<CreateVariantToolInput> {
    constructor(
        private readonly productVariantService: ProductVariantService,
        private readonly productService: ProductService,
        private readonly stockLevelService: StockLevelService,
        private readonly customFieldInput: McpCustomFieldInputService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateVariantToolInput) {
        await this.customFieldInput.assertWritable(ctx, 'ProductVariant', input.input.customFields);
        const product = await this.productService.findOne(ctx, input.productId);
        if (!product) {
            throw new UserInputError(`Product ${input.productId} is not available in the active channel.`);
        }
        const [variant] = await this.productVariantService.create(ctx, [
            { ...input.input, productId: input.productId },
        ]);
        const { stockOnHand } = await this.stockLevelService.getAvailableStock(ctx, variant.id);
        return { variant: this.serializer.adminVariant(variant, stockOnHand) };
    }
}
