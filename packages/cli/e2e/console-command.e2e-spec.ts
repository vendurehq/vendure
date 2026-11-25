import { afterEach, describe, expect, it } from 'vitest';

import { CliTestProject, createTestProject } from './cli-test-utils.js';

const MANIFEST = JSON.stringify({
    schemaVersion: 1,
    project: { id: '22222222-2222-4222-8222-222222222222', name: 'Storefront' },
    account: { id: '11111111-1111-4111-8111-111111111111', name: 'Acme' },
    link: { id: '33333333-3333-4333-8333-333333333333', protocolVersion: 1 },
});

function envelopeOf(stdout: string) {
    return JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
}

describe('CLI Console Command E2E', () => {
    let testProject: CliTestProject;

    afterEach(() => {
        testProject?.cleanup();
    });

    it('lists the Console commands, and the options of console link', async () => {
        testProject = createTestProject('console-help');

        const group = await testProject.runCliCommand(['console', '--help']);
        expect(group.exitCode).toBe(0);
        for (const command of ['link', 'status', 'unlink']) {
            expect(group.stdout).toContain(command);
        }

        const link = await testProject.runCliCommand(['console', 'link', '--help']);
        expect(link.exitCode).toBe(0);
        expect(link.stdout).toContain('--dir');
        expect(link.stdout).toContain('--project <id|slug>');
        expect(link.stdout).toContain('--organization');
        expect(link.stdout).toContain('--replace-link');
        expect(link.stdout).not.toContain('--force');
    });

    it('reports an unlinked project without contacting Console', async () => {
        testProject = createTestProject('console-status');

        const result = await testProject.runCliCommand(['console', 'status']);

        expect(result.exitCode).toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toContain('Project: Not linked');
        expect(`${result.stdout}\n${result.stderr}`).toContain('Login: run vendure auth status');
    });

    it('removes only the local manifest, once the removeLink consent is given', async () => {
        testProject = createTestProject('console-unlink');
        testProject.writeFile('.vendure/project.json', MANIFEST);
        testProject.writeFile('.vendure/credentials.json', 'machine-local');

        const asked = await testProject.runCliCommand(['console', 'unlink', '--json'], { expectError: true });
        const incomplete = envelopeOf(asked.stdout);
        expect(incomplete.status).toBe('incomplete');
        expect(incomplete.needs).toEqual([
            expect.objectContaining({ kind: 'consent', consent: 'removeLink' }),
        ]);
        expect(testProject.fileExists('.vendure/project.json')).toBe(true);

        const result = await testProject.runCliCommand([
            'console',
            'unlink',
            '--remove-link',
            incomplete.needs[0].digest,
            '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(envelopeOf(result.stdout)).toMatchObject({ status: 'ok', output: { removed: true } });
        expect(testProject.fileExists('.vendure/project.json')).toBe(false);
        expect(testProject.readFile('.vendure/credentials.json')).toBe('machine-local');
    });

    it('refuses a --project that is a directory, and points to --dir', async () => {
        testProject = createTestProject('console-project-dir');

        const result = await testProject.runCliCommand(['console', 'link', '--project', '.', '--json'], {
            expectError: true,
        });

        expect(result.exitCode).toBe(1);
        expect(envelopeOf(result.stdout)).toMatchObject({
            status: 'error',
            error: { code: 'console.project-is-directory' },
        });
    });
});
