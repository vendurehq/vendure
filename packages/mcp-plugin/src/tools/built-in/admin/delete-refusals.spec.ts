import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { DeleteRoleTool } from './delete-role.tool';
import { DeleteTaxCategoryTool } from './delete-tax-category.tool';

// A caller can call a destructive tool with a digest it got earlier, so each refusal is checked again in
// execute, not only when the preview is built.
describe('delete tool refusals in execute', () => {
    it('delete_role refuses a system role without calling core', async () => {
        const roleService = {
            findOne: () => Promise.resolve({ id: 1, code: SUPER_ADMIN_ROLE_CODE, permissions: [] }),
            delete: vi.fn(),
        };
        await expect(new DeleteRoleTool(roleService as any).execute({} as any, { id: 1 })).rejects.toThrow(
            UserInputError,
        );
        expect(roleService.delete).not.toHaveBeenCalled();
    });

    it('delete_tax_category refuses a category that variants use without calling core', async () => {
        const taxCategoryService = {
            findOne: () => Promise.resolve({ id: 2, name: 'Standard' }),
            delete: vi.fn(),
        };
        const connection = { getRepository: () => ({ count: () => Promise.resolve(3) }) };
        await expect(
            new DeleteTaxCategoryTool(taxCategoryService as any, connection as any).execute({} as any, {
                id: 2,
            }),
        ).rejects.toThrow('is used by 3 product variant(s)');
        expect(taxCategoryService.delete).not.toHaveBeenCalled();
    });
});
