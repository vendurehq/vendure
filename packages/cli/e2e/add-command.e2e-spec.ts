/*
 * E2E tests for the `vendure add` subcommands. They run the built CLI with `--json` in a copy of
 * the test project and build up one plugin, one command at a time.
 */
import { COMMAND_EXIT_CODES } from '@vendure/common/lib/command';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cliPath = join(import.meta.dirname, '..', 'dist', 'cli.js');

interface Run {
    envelope: any;
    exitCode: number;
    stderr: string;
}

function runCli(cwd: string, args: string[]): Promise<Run> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, ...args], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, VENDURE_CLI_NON_INTERACTIVE: '1' },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('error', reject);
        child.on('close', code => {
            const exitCode = code ?? -1;
            if (!args.includes('--json')) {
                resolve({ envelope: undefined, exitCode, stderr });
                return;
            }
            try {
                resolve({ envelope: JSON.parse(stdout), exitCode, stderr });
            } catch {
                reject(new Error(`vendure ${args.join(' ')} wrote no JSON document: ${stdout}${stderr}`));
            }
        });
    });
}

describe('vendure add subcommands', { timeout: 120_000 }, () => {
    let dir: string;
    const add = (...args: string[]) => runCli(dir, ['add', ...args, '--json']);
    const read = (path: string) => readFileSync(join(dir, path), 'utf-8');
    const pluginDir = 'src/plugins/reviews';

    beforeAll(() => {
        // Inside the repository, so the project resolves `@vendure/core` from its `node_modules`.
        dir = join(import.meta.dirname, 'fixtures', `.tmp-add-${randomBytes(6).toString('hex')}`);
        const source = join(import.meta.dirname, 'fixtures', 'test-project');
        // The migrate spec writes its database and migrations into the fixture while it runs.
        const shared = [join(source, 'test.db'), join(source, 'migrations')];
        cpSync(source, dir, { recursive: true, filter: path => !shared.some(s => path.startsWith(s)) });
    });

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('creates a plugin and adds it to the Vendure config', async () => {
        const { envelope, exitCode } = await add('plugin', 'reviews');

        expect(exitCode).toBe(0);
        expect(envelope).toMatchObject({ status: 'ok', output: { plugin: 'ReviewsPlugin' } });
        expect(existsSync(join(dir, pluginDir, 'reviews.plugin.ts'))).toBe(true);
        expect(read('src/vendure-config.ts')).toContain('ReviewsPlugin.init({})');
    });

    it('adds an entity to the plugin', async () => {
        const { envelope } = await add(
            'entity',
            'ProductReview',
            '--plugin',
            'ReviewsPlugin',
            '--custom-fields',
        );

        expect(envelope).toMatchObject({
            status: 'ok',
            output: { entity: 'ProductReview', plugin: 'ReviewsPlugin' },
        });
        expect(read(`${pluginDir}/entities/product-review.entity.ts`)).toContain('class ProductReview');
        expect(read(`${pluginDir}/reviews.plugin.ts`)).toMatch(/entities: \[ProductReview\]/);
    });

    it('adds a CRUD service for the entity, and a basic service', async () => {
        const crud = await add(
            'service',
            'ProductReviewService',
            '--plugin',
            'ReviewsPlugin',
            '--entity',
            'ProductReview',
        );
        const basic = await add('service', 'ReviewService', '--plugin', 'ReviewsPlugin');

        expect(crud.envelope).toMatchObject({ status: 'ok', output: { entity: 'ProductReview' } });
        expect(basic.envelope).toMatchObject({ status: 'ok', output: { entity: null } });
        expect(read(`${pluginDir}/services/product-review.service.ts`)).toContain(
            'getRepository(ctx, ProductReview)',
        );
        expect(read(`${pluginDir}/reviews.plugin.ts`)).toMatch(/providers: \[[^\]]*ProductReviewService/);
    });

    it('adds a job queue to a service', async () => {
        const { envelope } = await add(
            'job-queue',
            '--plugin',
            'ReviewsPlugin',
            '--service',
            'ReviewService',
            '--name',
            'review-indexing',
        );

        expect(envelope).toMatchObject({ status: 'ok', output: { triggerMethod: 'triggerReviewIndexing' } });
        expect(read(`${pluginDir}/services/review.service.ts`)).toContain("name: 'review-indexing'");
    });

    it('adds the CRUD API of an entity service', async () => {
        const { envelope } = await add(
            'api-extension',
            '--plugin',
            'ReviewsPlugin',
            '--service',
            'ProductReviewService',
        );

        expect(envelope).toMatchObject({ status: 'ok', output: { crud: true } });
        expect(read(`${pluginDir}/reviews.plugin.ts`)).toContain('adminApiExtensions');
    });

    it('asks for an operation name for a service without an entity', async () => {
        const { envelope, exitCode } = await add(
            'api-extension',
            '--plugin',
            'ReviewsPlugin',
            '--service',
            'ReviewService',
        );

        expect(envelope).toMatchObject({
            status: 'incomplete',
            needs: [
                { kind: 'input', field: 'queryName' },
                { kind: 'input', field: 'mutationName' },
            ],
        });
        expect(exitCode).toBe(COMMAND_EXIT_CODES.incomplete);
    });

    it('adds a named query for a service without an entity', async () => {
        const { envelope } = await add(
            'api-extension',
            '--plugin',
            'ReviewsPlugin',
            '--service',
            'ReviewService',
            '--query-name',
            'reviewCount',
        );

        expect(envelope).toMatchObject({ status: 'ok', output: { crud: false } });
        expect(read(`${pluginDir}/services/review.service.ts`)).toContain('async reviewCount(');
    });

    it('adds Dashboard extensions to the plugin', async () => {
        const { envelope } = await add('dashboard', '--plugin', 'ReviewsPlugin');

        expect(envelope).toMatchObject({ status: 'ok' });
        expect(existsSync(join(dir, pluginDir, 'dashboard', 'index.tsx'))).toBe(true);
        expect(read(`${pluginDir}/reviews.plugin.ts`)).toContain("dashboard: './dashboard/index.tsx'");
    });

    it('lists the missing inputs, with the plugins to choose from', async () => {
        const { envelope } = await add('entity');

        expect(envelope.status).toBe('incomplete');
        expect(envelope.needs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ field: 'name' }),
                expect.objectContaining({ field: 'plugin', choices: ['ReviewsPlugin'] }),
            ]),
        );
    });

    it('reports a plugin, a service or a file that does not fit as coded errors', async () => {
        const missingPlugin = await add('entity', 'Other', '--plugin', 'MissingPlugin');
        const missingService = await add(
            'job-queue',
            '--plugin',
            'ReviewsPlugin',
            '--service',
            'Nope',
            '--name',
            'x1',
        );
        const existingFile = await add('entity', 'ProductReview', '--plugin', 'ReviewsPlugin');

        expect(missingPlugin.envelope.error).toMatchObject({ code: 'add.plugin-not-found' });
        expect(missingService.envelope.error).toMatchObject({ code: 'add.service-not-found' });
        expect(existingFile.envelope.error).toMatchObject({ code: 'add.file-exists' });
    });

    it('still runs the subcommands for the older flags', async () => {
        const { exitCode, stderr } = await runCli(dir, [
            'add',
            '-e',
            'ReviewVote',
            '--selected-plugin',
            'ReviewsPlugin',
        ]);

        expect(exitCode, stderr).toBe(0);
        expect(existsSync(join(dir, pluginDir, 'entities', 'review-vote.entity.ts'))).toBe(true);
    });

    // The CLI guide shows `vendure add -p MyPlugin`, a name `add plugin` would not take as typed.
    it('takes the plugin names the older flag took', async () => {
        const { exitCode, stderr } = await runCli(dir, ['add', '-p', 'ExtraPlugin']);

        expect(exitCode, stderr).toBe(0);
        expect(existsSync(join(dir, 'src/plugins/extra/extra.plugin.ts'))).toBe(true);
        expect(read('src/plugins/extra/extra.plugin.ts')).toContain('class ExtraPlugin');
    });

    // On `vendure add`, `--plugin` creates a plugin, so the text names the subcommand to run.
    it('names the subcommand to run when an older flag lacks an input', async () => {
        const { exitCode, stderr } = await runCli(dir, ['add', '-e', 'Review']);

        expect(exitCode).toBe(COMMAND_EXIT_CODES.incomplete);
        expect(stderr).toContain('vendure add entity --name "Review"');
        expect(stderr).toContain('--plugin');
    });
});
