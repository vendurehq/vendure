import { afterEach, describe, expect, it } from 'vitest';

import { CliTestProject, createTestProject } from './cli-test-utils';

describe('CLI Console Command E2E', () => {
    let testProject: CliTestProject;

    afterEach(() => {
        testProject?.cleanup();
    });

    it('shows the Console actions and safety options in help', async () => {
        testProject = createTestProject('console-help');

        const result = await testProject.runCliCommand(['console', '--help']);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('link | status | unlink');
        expect(result.stdout).toContain('--project <path>');
        expect(result.stdout).toContain('--force');
    });

    it('requires a value when --project is present', async () => {
        testProject = createTestProject('console-project-option');

        const result = await testProject.runCliCommand(['console', 'status', '--project'], {
            expectError: true,
        });

        expect(result.exitCode).toBe(1);
        expect(`${result.stdout}\n${result.stderr}`).toContain("option '--project <path>' argument missing");
    });

    it('reports an unlinked project without contacting Console', async () => {
        testProject = createTestProject('console-status');

        const result = await testProject.runCliCommand(['console', 'status']);

        expect(result.exitCode).toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toContain('Project: Not linked');
        expect(`${result.stdout}\n${result.stderr}`).toContain('Authentication: Not stored locally');
    });

    it('removes only the local manifest with --force', async () => {
        testProject = createTestProject('console-unlink');
        testProject.writeFile(
            '.vendure/project.json',
            JSON.stringify({
                schemaVersion: 1,
                project: { id: '22222222-2222-4222-8222-222222222222', name: 'Storefront' },
                account: { id: '11111111-1111-4111-8111-111111111111', name: 'Acme' },
                link: { id: '33333333-3333-4333-8333-333333333333', protocolVersion: 1 },
            }),
        );
        testProject.writeFile('.vendure/credentials.json', 'machine-local');

        const result = await testProject.runCliCommand(['console', 'unlink', '--force']);

        expect(result.exitCode).toBe(0);
        expect(testProject.fileExists('.vendure/project.json')).toBe(false);
        expect(testProject.readFile('.vendure/credentials.json')).toBe('machine-local');
    });
});
