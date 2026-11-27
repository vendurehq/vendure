import { UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { MCP_TOOL_TOGGLES_STORE_KEY } from '../../../constants';

import { SetSettingTool } from './set-setting.tool';

function settingsStore(overrides: Record<string, unknown> = {}) {
    return {
        getFieldDefinition: vi.fn(() => ({ name: 'field' })),
        hasWritePermission: vi.fn(() => true),
        isReadonly: vi.fn(() => false),
        set: vi.fn((_ctx: unknown, key: string) => Promise.resolve({ key, result: true })),
        ...overrides,
    };
}

const ctx = {} as any;

describe('set_setting', () => {
    it('refuses keys in the mcp namespace without writing', async () => {
        const store = settingsStore();
        const tool = new SetSettingTool(store as any);
        await expect(tool.execute(ctx, { key: MCP_TOOL_TOGGLES_STORE_KEY, value: {} })).rejects.toThrow(
            UserInputError,
        );
        expect(store.set).not.toHaveBeenCalled();
    });

    it('refuses a key that no settings field registers', async () => {
        const store = settingsStore({ getFieldDefinition: vi.fn(() => undefined) });
        const tool = new SetSettingTool(store as any);
        await expect(tool.execute(ctx, { key: 'other.missing', value: 1 })).rejects.toThrow(
            /No settings field/,
        );
        expect(store.set).not.toHaveBeenCalled();
    });

    it('refuses a read-only field and one the caller may not write', async () => {
        const readonly = settingsStore({ isReadonly: vi.fn(() => true) });
        await expect(
            new SetSettingTool(readonly as any).execute(ctx, { key: 'shop.theme', value: 'dark' }),
        ).rejects.toThrow(/read-only/);
        const forbidden = settingsStore({ hasWritePermission: vi.fn(() => false) });
        await expect(
            new SetSettingTool(forbidden as any).execute(ctx, { key: 'shop.theme', value: 'dark' }),
        ).rejects.toThrow(/permission/);
        expect(readonly.set).not.toHaveBeenCalled();
        expect(forbidden.set).not.toHaveBeenCalled();
    });

    it("reports the settings store's own validation error", async () => {
        const store = settingsStore({
            set: vi.fn(() =>
                Promise.resolve({ key: 'shop.theme', result: false, error: 'must be light or dark' }),
            ),
        });
        await expect(
            new SetSettingTool(store as any).execute(ctx, { key: 'shop.theme', value: 'blue' }),
        ).rejects.toThrow('must be light or dark');
    });

    it('writes a value in another namespace', async () => {
        const store = settingsStore();
        const result = await new SetSettingTool(store as any).execute(ctx, {
            key: 'shop.theme',
            value: 'dark',
        });
        expect(store.set).toHaveBeenCalledWith(ctx, 'shop.theme', 'dark');
        expect(result).toEqual({ key: 'shop.theme', value: 'dark' });
    });
});
