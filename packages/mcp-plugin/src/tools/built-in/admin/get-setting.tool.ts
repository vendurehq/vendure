import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, SettingsStoreService, UserInputError } from '@vendure/core';
import { McpTool, McpToolHandler, shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

const getSettingInput = z.strictObject({
    key: shortText.describe('The full settings key, "<namespace>.<field>", e.g. "myPlugin.theme".'),
});

type GetSettingInput = z.infer<typeof getSettingInput>;

@McpTool({
    name: 'get_setting',
    toolset: 'admin',
    description:
        'Read one settings-store value by its full key, "<namespace>.<field>". The value is scoped as its field defines, for example per channel or per user.',
    keywords: [
        'read a plugin setting',
        'what is this setting set to',
        'look up a stored option',
        'check a configuration value',
        'get a settings store key',
        'show a store setting',
    ],
    permissions: [Permission.Authenticated],
    behavior: 'readonly',
    inputSchema: getSettingInput,
})
@Injectable()
export class GetSettingTool implements McpToolHandler<GetSettingInput> {
    constructor(private readonly settingsStoreService: SettingsStoreService) {}

    async execute(ctx: RequestContext, input: GetSettingInput) {
        if (!this.settingsStoreService.getFieldDefinition(input.key)) {
            throw new UserInputError(`No settings field is registered with the key "${input.key}".`);
        }
        if (!this.settingsStoreService.hasReadPermission(ctx, input.key)) {
            throw new UserInputError(`You do not have permission to read the setting "${input.key}".`);
        }
        const value = await this.settingsStoreService.get(ctx, input.key);
        return { key: input.key, value: value ?? null };
    }
}
