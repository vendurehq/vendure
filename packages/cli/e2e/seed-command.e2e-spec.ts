/**
 * E2E tests for `vendure seed`. Each runs through the command host against a project with a
 * SQLite database, the way the CLI runs it.
 */
import type { CommandDefinition } from '@vendure/common/lib/command';
import { CREATE_RECORD_PATH } from '@vendure/common/lib/create-record';
import * as fs from 'fs-extra';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runCommandInHarness } from '../src/command-host/__tests__/command-harness.js';
import { seedDefinition } from '../src/commands/seed/seed.command.js';

import { config } from './fixtures/seed-project/src/vendure-config.js';

const PROJECT_DIR = path.join(import.meta.dirname, 'fixtures', 'seed-project');
const DB_PATH = path.join(PROJECT_DIR, 'seed.db');
const PRISTINE_DB_PATH = path.join(PROJECT_DIR, 'seed.pristine.db');
const RECORD_PATH = path.join(PROJECT_DIR, CREATE_RECORD_PATH);

function seed(input: Record<string, unknown>) {
    return runCommandInHarness(seedDefinition, input, { projectRoot: PROJECT_DIR });
}

async function writeRecord(fields: { preset: unknown; scenario: unknown }) {
    await fs.outputJson(RECORD_PATH, {
        version: 1,
        createdWith: '4.0.0',
        packageManager: 'npm',
        features: [],
        storefront: null,
        agents: [],
        ...fields,
    });
}

/** Opens the seeded database read-only, to check what a run wrote. */
async function query<T = any>(sql: string): Promise<T[]> {
    const Database: any = (await import('better-sqlite3')).default;
    const db = new Database(DB_PATH, { readonly: true });
    try {
        return db.prepare(sql).all() as T[];
    } finally {
        db.close();
    }
}

describe('Seed command E2E', { timeout: 120_000 }, () => {
    let originalCwd: string;

    beforeAll(async () => {
        originalCwd = process.cwd();
        process.chdir(PROJECT_DIR);
        await fs.remove(DB_PATH);
        // Creates the schema, the default channel and the SuperAdmin, as a first start does.
        const { bootstrapWorker, DefaultLogger, LogLevel } = await import('@vendure/core');
        const { app } = await bootstrapWorker({
            ...config,
            logger: new DefaultLogger({ level: LogLevel.Error }),
        });
        await app.close();
        await fs.copy(DB_PATH, PRISTINE_DB_PATH);
    });

    beforeEach(async () => {
        process.chdir(PROJECT_DIR);
        await fs.copy(PRISTINE_DB_PATH, DB_PATH);
        await fs.remove(path.join(PROJECT_DIR, '.vendure'));
        delete process.env.SEED_SCENARIO_FAIL;
    });

    afterAll(async () => {
        process.chdir(originalCwd);
        await fs.remove(DB_PATH);
        await fs.remove(PRISTINE_DB_PATH);
        await fs.remove(path.join(PROJECT_DIR, '.vendure'));
    });

    describe('seed --preset', () => {
        it('lists the presets without a preset', async () => {
            const result = await seed({});

            expect(result.envelope.status).toBe('ok');
            const names = (result.envelope.output as any).presets.map((p: any) => p.name);
            expect(names).toEqual(['uk', 'us', 'au', 'single-country']);
        });

        it('applies a preset', async () => {
            const result = await seed({ preset: 'uk' });

            expect(result.envelope.status).toBe('ok');
            expect(result.envelope.output).toMatchObject({
                preset: { status: 'applied', name: 'uk', created: { zones: 1, taxRates: 3 } },
            });
            const rows = await query(
                "SELECT value FROM settings_store_entry WHERE key = 'vendure.seed.preset'",
            );
            expect(JSON.parse(rows[0].value)).toMatchObject({ name: 'uk', options: {} });
        });

        it('asks for a missing required option', async () => {
            const result = await seed({ preset: 'single-country', country: 'NZ' });

            expect(result.envelope.status).toBe('incomplete');
            expect(result.envelope.needs).toEqual([
                expect.objectContaining({ kind: 'input', field: 'currency' }),
            ]);
        });

        it('rejects an unknown preset with a fix that lists the presets', async () => {
            const result = await seed({ preset: 'mars' });

            expect(result.envelope.status).toBe('error');
            expect(result.envelope.error).toMatchObject({
                code: 'core.preset-unknown',
                fixes: [{ path: ['seed'], input: {} }],
            });
        });

        it('refuses a database that is not empty', async () => {
            await seed({ preset: 'uk' });
            const result = await seed({ preset: 'us' });

            expect(result.envelope.status).toBe('error');
            expect(result.envelope.error?.code).toBe('core.preset-database-not-empty');
            expect(result.envelope.error?.message).toContain('"uk" preset');
        });

        it('rejects --first-run with a preset', async () => {
            const result = await seed({ firstRun: true, preset: 'uk' });

            expect(result.envelope.error?.code).toBe('seed.conflicting-options');
        });
    });

    describe('seed --first-run', () => {
        it('does nothing without a create record', async () => {
            const result = await seed({ firstRun: true });

            expect(result.envelope.status).toBe('ok');
            expect(result.envelope.output).toMatchObject({
                preset: { status: 'skipped' },
                scenario: { status: 'skipped' },
            });
        });

        it('applies the recorded preset once, then returns at once', async () => {
            await writeRecord({
                preset: { name: 'single-country', options: { country: 'NZ', currency: 'NZD' } },
                scenario: null,
            });

            const first = await seed({ firstRun: true });
            expect(first.envelope.status).toBe('ok');
            expect(first.envelope.output).toMatchObject({
                preset: { status: 'applied', name: 'single-country' },
                scenario: { status: 'skipped' },
            });

            const started = Date.now();
            const second = await seed({ firstRun: true });
            const elapsed = Date.now() - started;
            expect(second.envelope.output).toMatchObject({
                preset: { status: 'already-applied', name: 'single-country' },
            });
            // eslint-disable-next-line no-console
            console.info(`seed --first-run on a seeded database took ${elapsed} ms`);
            const zones = await query('SELECT name FROM zone');
            expect(zones).toEqual([{ name: 'NZ' }]);
        });

        it('applies the preset and the scenario, and retries only a failed scenario', async () => {
            await writeRecord({
                preset: { name: 'uk', options: {} },
                scenario: { name: 'demo', package: './scenario-pack', version: '1.0.0' },
            });

            process.env.SEED_SCENARIO_FAIL = 'true';
            const failedRun = await seed({ firstRun: true });
            expect(failedRun.envelope.status).toBe('failed');
            expect(failedRun.envelope.output).toMatchObject({
                preset: { status: 'applied', name: 'uk' },
                scenario: { status: 'failed', name: 'demo', error: { code: 'seed.failed' } },
            });
            expect(await query("SELECT name FROM zone WHERE name = 'Scenario zone'")).toEqual([]);

            delete process.env.SEED_SCENARIO_FAIL;
            const retry = await seed({ firstRun: true });
            expect(retry.envelope.status).toBe('ok');
            expect(retry.envelope.output).toMatchObject({
                preset: { status: 'already-applied', name: 'uk' },
                scenario: { status: 'applied', name: 'demo' },
            });
            expect(await query("SELECT name FROM zone WHERE name = 'Scenario zone'")).toHaveLength(1);

            const again = await seed({ firstRun: true });
            expect(again.envelope.output).toMatchObject({
                preset: { status: 'already-applied' },
                scenario: { status: 'already-applied' },
            });
        });

        it('skips a database that is not empty and has no sentinel, and writes nothing', async () => {
            const Database: any = (await import('better-sqlite3')).default;
            const db = new Database(DB_PATH);
            db.prepare(
                "INSERT INTO zone (name, createdAt, updatedAt) VALUES ('Hand-made', datetime('now'), datetime('now'))",
            ).run();
            db.close();
            await writeRecord({ preset: { name: 'uk', options: {} }, scenario: null });

            const result = await seed({ firstRun: true });

            expect(result.envelope.status).toBe('ok');
            expect(result.envelope.output).toMatchObject({ preset: { status: 'skipped', name: 'uk' } });
            expect(await query('SELECT name FROM zone')).toEqual([{ name: 'Hand-made' }]);
            expect(
                await query("SELECT key FROM settings_store_entry WHERE key LIKE 'vendure.seed.%'"),
            ).toEqual([]);
        });

        it('ignores a record with a newer version, with a notice', async () => {
            await fs.outputJson(RECORD_PATH, { version: 2 });

            const result = await seed({ firstRun: true });

            expect(result.envelope.status).toBe('ok');
            expect(result.envelope.notices).toEqual([
                expect.objectContaining({ level: 'warning', message: expect.stringContaining('version 2') }),
            ]);
        });

        it('rejects an invalid record', async () => {
            await fs.outputJson(RECORD_PATH, { version: 1, preset: 'uk' });

            const result = await seed({ firstRun: true });

            expect(result.envelope.error?.code).toBe('seed.create-record-invalid');
        });
    });
});
