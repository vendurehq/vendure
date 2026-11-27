import { Injectable, OnModuleInit } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../../api/common/request-context';
import { SettingsStoreScopes } from '../../../config/settings-store/settings-store-types';
import { SettingsStoreService } from '../settings-store/settings-store.service';

/**
 * @description
 * The settings-store namespace of the seed sentinels.
 *
 * @docsCategory import-export
 * @docsPage Seed sentinels
 * @since 4.0.0
 */
export const SEED_SETTINGS_NAMESPACE = 'vendure.seed';

/**
 * @description
 * The settings-store key that records the base-data preset a database was seeded with.
 *
 * @docsCategory import-export
 * @docsPage Seed sentinels
 * @since 4.0.0
 */
export const SEED_PRESET_KEY = `${SEED_SETTINGS_NAMESPACE}.preset`;

/**
 * @description
 * The settings-store key that records the scenario a database was seeded with.
 *
 * @docsCategory import-export
 * @docsPage Seed sentinels
 * @since 4.0.0
 */
export const SEED_SCENARIO_KEY = `${SEED_SETTINGS_NAMESPACE}.scenario`;

/**
 * @description
 * The value of the `vendure.seed.preset` sentinel.
 *
 * @docsCategory import-export
 * @docsPage Seed sentinels
 * @since 4.0.0
 */
export interface SeedPresetSentinel {
    name: string;
    options: Record<string, string>;
    /** An ISO 8601 date-time string. */
    appliedAt: string;
}

/**
 * @description
 * The value of the `vendure.seed.scenario` sentinel.
 *
 * @docsCategory import-export
 * @docsPage Seed sentinels
 * @since 4.0.0
 */
export interface SeedScenarioSentinel {
    name: string;
    package: string;
    version: string;
    /** An ISO 8601 date-time string. */
    appliedAt: string;
}

/**
 * @description
 * Reads and writes the seed sentinels. A sentinel records that a seed ran against this database. It
 * is written in the same transaction as the seeded data, so the data and the sentinel commit
 * together or not at all.
 *
 * The keys are global, read-only over the GraphQL API, and readable by the SuperAdmin only.
 *
 * @docsCategory import-export
 * @docsPage Seed sentinels
 * @since 4.0.0
 */
@Injectable()
export class SeedSentinelService implements OnModuleInit {
    constructor(private settingsStoreService: SettingsStoreService) {}

    onModuleInit() {
        this.settingsStoreService.register({
            namespace: SEED_SETTINGS_NAMESPACE,
            fields: [
                {
                    name: 'preset',
                    scope: SettingsStoreScopes.global,
                    readonly: true,
                    requiresPermission: Permission.SuperAdmin,
                },
                {
                    name: 'scenario',
                    scope: SettingsStoreScopes.global,
                    readonly: true,
                    requiresPermission: Permission.SuperAdmin,
                },
            ],
        });
    }

    getPresetSentinel(ctx: RequestContext): Promise<SeedPresetSentinel | undefined> {
        return this.settingsStoreService.get<SeedPresetSentinel>(ctx, SEED_PRESET_KEY);
    }

    getScenarioSentinel(ctx: RequestContext): Promise<SeedScenarioSentinel | undefined> {
        return this.settingsStoreService.get<SeedScenarioSentinel>(ctx, SEED_SCENARIO_KEY);
    }

    /**
     * Writes the preset sentinel. Call it inside the transaction that seeds the data.
     */
    async setPresetSentinel(ctx: RequestContext, value: SeedPresetSentinel): Promise<void> {
        await this.write(ctx, SEED_PRESET_KEY, value);
    }

    /**
     * Writes the scenario sentinel. Call it inside the transaction that seeds the data.
     */
    async setScenarioSentinel(ctx: RequestContext, value: SeedScenarioSentinel): Promise<void> {
        await this.write(ctx, SEED_SCENARIO_KEY, value);
    }

    private async write(ctx: RequestContext, key: string, value: object): Promise<void> {
        // `set()` reports a failure in its result instead of throwing. A sentinel that is not
        // written must roll the seed back, so the failure is thrown here.
        const result = await this.settingsStoreService.set(ctx, key, value as any);
        if (!result.result) {
            throw new Error(`Could not write the seed sentinel ${key}: ${result.error ?? ''}`);
        }
    }
}
