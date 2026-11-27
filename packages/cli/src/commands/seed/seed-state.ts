import type { VendureConfig } from '@vendure/core';

import { requireFromProjectCore } from '../../shared/project-core.js';

/** The settings-store keys of the seed sentinels, as `@vendure/core` registers them. */
export const SEED_PRESET_KEY = 'vendure.seed.preset';
export const SEED_SCENARIO_KEY = 'vendure.seed.scenario';

export interface SeedState {
    preset?: { name: string; options?: Record<string, string> };
    scenario?: { name: string; package?: string; version?: string };
    /** Whether the database has none of the setup data a preset creates. */
    empty: boolean;
}

/** The tables a preset refuses to seed when they hold rows, as `applyPreset()` checks them. */
const SETUP_TABLES = [
    'region',
    'zone',
    'tax_category',
    'tax_rate',
    'shipping_method',
    'payment_method',
    'product',
] as const;

/**
 * Reads the seed sentinels and whether the database is empty, over a plain database connection.
 * It loads no entities and does not bootstrap Vendure, so it stays fast enough to run on every
 * `vendure dev` start.
 */
export async function readSeedState(config: VendureConfig, cwd?: string): Promise<SeedState> {
    const { DataSource } = requireFromProjectCore<typeof import('typeorm')>('typeorm', cwd);
    const options = config.dbConnectionOptions as unknown as Record<string, unknown>;
    const prefix = typeof options.entityPrefix === 'string' ? options.entityPrefix : '';
    const dataSource = new DataSource({
        ...(config.dbConnectionOptions as object),
        entities: [],
        migrations: [],
        subscribers: [],
        synchronize: false,
        migrationsRun: false,
        logging: false,
    } as any);
    await dataSource.initialize();
    try {
        const { driver } = dataSource;
        const schema = (driver.options as { schema?: string }).schema;
        const table = (name: string) => driver.buildTableName(`${prefix}${name}`, schema, driver.database);
        const query = () => dataSource.createQueryBuilder();

        const rows = await query()
            .select('t.key', 'key')
            .addSelect('t.value', 'value')
            .from(table('settings_store_entry'), 't')
            .where('t.key IN (:...keys)', { keys: [SEED_PRESET_KEY, SEED_SCENARIO_KEY] })
            // Global settings have an empty scope.
            .andWhere("(t.scope = '' OR t.scope IS NULL)")
            .getRawMany<{ key: string; value: unknown }>();
        const valueOf = (key: string) => parseJson(rows.find(r => r.key === key)?.value);

        let empty = true;
        for (const name of SETUP_TABLES) {
            const row = await query().select('1', 'found').from(table(name), 't').limit(1).getRawOne();
            if (row) {
                empty = false;
                break;
            }
        }
        if (empty) {
            const channels = await query()
                .select('COUNT(*)', 'count')
                .from(table('channel'), 't')
                .getRawOne<{ count: string | number }>();
            empty = Number(channels?.count ?? 0) <= 1;
        }
        return {
            preset: asNamed(valueOf(SEED_PRESET_KEY)),
            scenario: asNamed(valueOf(SEED_SCENARIO_KEY)),
            empty,
        };
    } finally {
        await dataSource.destroy();
    }
}

function parseJson(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function asNamed<T extends { name: string }>(value: unknown): T | undefined {
    return typeof value === 'object' && value !== null && typeof (value as T).name === 'string'
        ? (value as T)
        : undefined;
}
