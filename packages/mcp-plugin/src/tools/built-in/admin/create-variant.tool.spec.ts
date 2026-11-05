import { UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CreateVariantTool } from './create-variant.tool';

const customFieldInput = { assertWritable: () => Promise.resolve() } as any;
const serializer = { adminVariant: (variant: unknown) => variant } as any;

describe('CreateVariantTool', () => {
    it('refuses a parent product the active channel cannot see, and writes nothing', async () => {
        const create = vi.fn();
        const productService = { findOne: () => Promise.resolve(undefined) } as any;
        const tool = new CreateVariantTool(
            { create } as any,
            productService,
            { getAvailableStock: vi.fn() } as any,
            customFieldInput,
            serializer,
        );

        const rejection = tool.execute(
            {} as any,
            {
                productId: 42,
                input: { sku: 'SKU-1', translations: [] },
            } as any,
        );

        await expect(rejection).rejects.toBeInstanceOf(UserInputError);
        await expect(rejection).rejects.toThrowError('Product 42 is not available in the active channel.');
        expect(create).not.toHaveBeenCalled();
    });
});
