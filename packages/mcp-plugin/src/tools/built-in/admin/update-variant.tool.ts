import { Injectable } from '@nestjs/common';
import {
    Permission,
    ProductVariantService,
    RequestContext,
    StockLevelService,
    UserInputError,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCustomFieldInputService } from '../custom-field-input.service';
import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

import { variantFieldsSchema } from './entity-field-schemas';
import { variantTranslationSchema } from './translation-schemas';

const updateVariantInputSchema = variantFieldsSchema.extend({
    sku: shortText.describe('Stock keeping unit.').optional(),
    translations: z
        .array(variantTranslationSchema)
        .describe('Localized variant content to update.')
        .optional(),
});

const updateVariantInput = z.strictObject({
    id: idSchema.describe('Variant ID.'),
    input: updateVariantInputSchema,
});

type UpdateVariantToolInput = z.infer<typeof updateVariantInput>;

@McpTool({
    name: 'update_variant',
    toolset: 'admin',
    description:
        "Update an existing product variant's details, such as its price or SKU. Stock changes go " +
        'through adjust_stock.',
    keywords: [
        'edit a variant',
        'change a price or sku',
        'update a size or color option',
        'modify variant details',
        'fix a specific variation',
        'edit product option info',
    ],
    permissions: [Permission.UpdateProduct],
    behavior: 'mutating',
    inputSchema: updateVariantInput,
})
@Injectable()
export class UpdateVariantTool implements McpToolHandler<UpdateVariantToolInput> {
    constructor(
        private readonly productVariantService: ProductVariantService,
        private readonly stockLevelService: StockLevelService,
        private readonly customFieldInput: McpCustomFieldInputService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateVariantToolInput) {
        await this.customFieldInput.assertWritable(ctx, 'ProductVariant', input.input.customFields);
        const existing = await this.productVariantService.findOne(ctx, input.id, []);
        if (!existing) {
            throw new UserInputError(`Product variant ${input.id} is not available in the active channel.`);
        }
        const [variant] = await this.productVariantService.update(ctx, [{ ...input.input, id: input.id }]);
        const { stockOnHand } = await this.stockLevelService.getAvailableStock(ctx, variant.id);
        return { variant: this.serializer.adminVariant(variant, stockOnHand) };
    }
}
