import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, SettingsStoreService, UserInputError } from '@vendure/core';
import { McpTool, McpToolHandler, shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { MCP_SETTINGS_NAMESPACE } from '../../../constants';

const setSettingInput = z.strictObject({
    key: shortText.describe('The full settings key, "<namespace>.<field>", e.g. "myPlugin.theme".'),
    value: z.unknown().describe("The new value, as JSON. It must pass the field's own validation."),
});

type SetSettingInput = z.infer<typeof setSettingInput>;

@McpTool({
    name: 'set_setting',
    toolset: 'admin',
    description:
        `Write one settings-store value by its full key, "<namespace>.<field>". ` +
        `Keys in the "${MCP_SETTINGS_NAMESPACE}" namespace are refused, so the MCP tool settings stay with the Dashboard.`,
    keywords: [
        'change a plugin setting',
        'store a configuration value',
        'update a stored option',
        'save a settings store key',
        'set a store preference',
        'write a setting',
    ],
    permissions: [Permission.Authenticated],
    behavior: 'mutating',
    inputSchema: setSettingInput,
})
@Injectable()
export class SetSettingTool implements McpToolHandler<SetSettingInput> {
    constructor(private readonly settingsStoreService: SettingsStoreService) {}

    async execute(ctx: RequestContext, input: SetSettingInput) {
        // The namespace holds the tool toggles. An agent must not be able to switch off its own
        // limits. This guards against mistakes, not against a caller that can reach the Admin API.
        if (input.key.split('.')[0] === MCP_SETTINGS_NAMESPACE) {
            throw new UserInputError(
                `Settings in the "${MCP_SETTINGS_NAMESPACE}" namespace cannot be changed with this tool.`,
            );
        }
        if (input.value === undefined) {
            throw new UserInputError('A value is required. Send null to clear the setting.');
        }
        if (!this.settingsStoreService.getFieldDefinition(input.key)) {
            throw new UserInputError(`No settings field is registered with the key "${input.key}".`);
        }
        if (!this.settingsStoreService.hasWritePermission(ctx, input.key)) {
            throw new UserInputError(`You do not have permission to change the setting "${input.key}".`);
        }
        if (this.settingsStoreService.isReadonly(input.key)) {
            throw new UserInputError(`The setting "${input.key}" is read-only.`);
        }
        const result = await this.settingsStoreService.set(ctx, input.key, input.value as any);
        if (!result.result) {
            throw new UserInputError(result.error ?? `The setting "${input.key}" could not be saved.`);
        }
        return { key: input.key, value: input.value };
    }
}
