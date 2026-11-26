/**
 * E2E tests for a config resolver that a project declares in its own package.json. The fixture is
 * a monorepo whose server app has no VendureConfig in its source: an async function in a shared
 * library builds it at run time, and the app imports that library through the path mappings of a
 * base tsconfig it extends.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runCommandInHarness } from '../src/command-host/__tests__/command-harness.js';
import { doctorDefinition } from '../src/commands/doctor/doctor.command.js';
import { generateMigrationDefinition } from '../src/commands/migrate/generate-migration/generate-migration.command.js';
import { runMigrationDefinition } from '../src/commands/migrate/run-migration/run-migration.command.js';

const SERVER_DIR = path.join(import.meta.dirname, 'fixtures', 'monorepo-project', 'apps', 'server');
const MIGRATIONS_DIR = path.join(SERVER_DIR, 'migrations');
const DB_PATH = path.join(SERVER_DIR, 'test.db');

async function reset() {
    await fs.remove(MIGRATIONS_DIR);
    await fs.remove(DB_PATH);
}

describe('A config resolver declared by the project', { timeout: 60_000 }, () => {
    let originalCwd: string;

    beforeAll(() => {
        originalCwd = process.cwd();
        // The commands find the project from the working directory, as they do when run there.
        process.chdir(SERVER_DIR);
    });
    beforeEach(reset);
    afterAll(async () => {
        process.chdir(originalCwd);
        await reset();
    });

    it('gives doctor the config that the shared library builds', async () => {
        const { envelope } = await runCommandInHarness(
            doctorDefinition,
            { check: ['config'] },
            { projectRoot: SERVER_DIR },
        );

        const output = envelope.output as { checks: Array<{ status: string; details?: string[] }> };
        const check = output.checks[0];
        expect(check.status).toBe('pass');
        expect(check.details?.join('\n')).toContain('the config resolver of the project example-server');
    });

    it('gives migrate generate and migrate run the config', async () => {
        const generated = await runCommandInHarness(
            generateMigrationDefinition,
            { name: 'initial' },
            { projectRoot: SERVER_DIR },
        );
        expect(generated.envelope.status).toBe('ok');
        const files = await fs.readdir(MIGRATIONS_DIR);
        expect(files.some(file => file.endsWith('-initial.ts'))).toBe(true);

        const ran = await runCommandInHarness(runMigrationDefinition, {}, { projectRoot: SERVER_DIR });
        expect(ran.envelope.status).toBe('ok');
        expect(ran.envelope.output).toMatchObject({ migrationsRan: [expect.stringContaining('Initial')] });
    });
});
