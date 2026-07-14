import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';

import { SetSettingsStoreValueResult } from '../../../config/settings-store/settings-store-types';
import { SettingsStoreService } from '../../../service/helpers/settings-store/settings-store.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

export class SettingsStoreInput {
    key: string;
    value: any;
}

const ErrorMessage = {
    permissions: 'Insufficient permissions to set settings store value',
    readonly: 'Cannot modify readonly settings store field via API',
};

/**
 * @description
 * Resolvers for settings store operations in the Admin API.
 */
@Resolver()
export class SettingsStoreAdminResolver {
    constructor(private readonly settingsStoreService: SettingsStoreService) {}

    @Query()
    @Allow(Permission.ReadSystem)
    async settingsStoreFieldDefinitions(@Ctx() ctx: RequestContext) {
        const allFields = this.settingsStoreService.getAllFieldDefinitions();

        // Filter to fields the user can read
        const readable = allFields.filter(({ key }) => this.settingsStoreService.hasReadPermission(ctx, key));

        // Batch-fetch current values
        const keys = readable.map(f => f.key);
        const values = keys.length > 0 ? await this.settingsStoreService.getMany(ctx, keys) : {};

        return readable.map(({ key, config }) => ({
            key,
            scopeType: this.settingsStoreService.getScopeType(config),
            readonly: config.readonly ?? false,
            currentValue: values[key] ?? null,
        }));
    }

    @Query()
    @Allow(Permission.Authenticated)
    async getSettingsStoreValue(@Ctx() ctx: RequestContext, @Args('key') key: string): Promise<any> {
        if (!this.settingsStoreService.hasReadPermission(ctx, key)) {
            return undefined;
        }
        return this.settingsStoreService.get(ctx, key);
    }

    @Query()
    @Allow(Permission.Authenticated)
    async getSettingsStoreValues(
        @Ctx() ctx: RequestContext,
        @Args('keys') keys: string[],
    ): Promise<Record<string, any>> {
        const permittedKeys = [];
        for (const key of keys) {
            if (this.settingsStoreService.hasReadPermission(ctx, key)) {
                permittedKeys.push(key);
            }
        }
        return this.settingsStoreService.getMany(ctx, permittedKeys);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async setSettingsStoreValue(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SettingsStoreInput,
    ): Promise<SetSettingsStoreValueResult> {
        try {
            if (!this.settingsStoreService.hasWritePermission(ctx, input.key)) {
                return {
                    key: input.key,
                    result: false,
                    error: ErrorMessage.permissions,
                };
            }
            if (this.settingsStoreService.isReadonly(input.key)) {
                return {
                    key: input.key,
                    result: false,
                    error: ErrorMessage.readonly,
                };
            }
            return this.settingsStoreService.set(ctx, input.key, input.value);
        } catch (error) {
            // Handle validation errors (e.g., invalid keys) as structured errors
            return {
                key: input.key,
                result: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async setSettingsStoreValues(
        @Ctx() ctx: RequestContext,
        @Args('inputs') inputs: SettingsStoreInput[],
    ): Promise<SetSettingsStoreValueResult[]> {
        const results: SetSettingsStoreValueResult[] = [];
        for (const input of inputs) {
            try {
                const hasPermission = this.settingsStoreService.hasWritePermission(ctx, input.key);
                const isWritable = !this.settingsStoreService.isReadonly(input.key);
                if (!hasPermission) {
                    results.push({
                        key: input.key,
                        result: false,
                        error: ErrorMessage.permissions,
                    });
                } else if (!isWritable) {
                    results.push({
                        key: input.key,
                        result: false,
                        error: ErrorMessage.readonly,
                    });
                } else {
                    const result = await this.settingsStoreService.set(ctx, input.key, input.value);
                    results.push(result);
                }
            } catch (error) {
                // Handle validation errors (e.g., invalid keys) as structured errors
                results.push({
                    key: input.key,
                    result: false,
                    error: error instanceof Error ? error.message : 'Unknown error occurred',
                });
            }
        }
        return results;
    }
}
