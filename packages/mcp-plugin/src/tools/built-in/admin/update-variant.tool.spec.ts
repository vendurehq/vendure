import { UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { UpdateVariantTool } from './update-variant.tool';

const customFieldInput = { assertWritable: () => Promise.resolve() } as any;
const serializer = { adminVariant: (variant: unknown) => variant } as any;

describe('UpdateVariantTool', () => {
    it('refuses a variant the active channel cannot see, and writes nothing', async () => {
        const update = vi.fn();
        const productVariantService = { findOne: () => Promise.resolve(undefined), update } as any;
        const tool = new UpdateVariantTool(
            productVariantService,
            { getAvailableStock: vi.fn() } as any,
            customFieldInput,
            serializer,
        );

        const rejection = tool.execute({} as any, { id: 42, input: { sku: 'SKU-1' } } as any);

        await expect(rejection).rejects.toBeInstanceOf(UserInputError);
        await expect(rejection).rejects.toThrowError(
            'Product variant 42 is not available in the active channel.',
        );
        expect(update).not.toHaveBeenCalled();
    });
});
