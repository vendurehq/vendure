import { afterEach, describe, expect, it } from 'vitest';

import { CliTestProject, createTestProject } from './cli-test-utils';

describe('CLI Doctor Command E2E', () => {
    let testProject: CliTestProject;

    afterEach(() => {
        if (testProject) {
            testProject.cleanup();
        }
    });

    describe('project check', () => {
        it('should pass project check in a valid Vendure project', async () => {
            testProject = createTestProject('doctor-project-pass');

            const result = await testProject.runCliCommand([
                'doctor',
                '--check',
                'project',
                '--format',
                'json',
            ]);

            expect(result.exitCode).toBe(0);
            const report = JSON.parse(result.stdout);
            expect(report.overallStatus).toBe('passed');
            expect(report.checks).toHaveLength(1);
            expect(report.checks[0].name).toBe('Project');
            expect(report.checks[0].status).toBe('pass');
        });

        it('should fail project check in a non-Vendure directory', async () => {
            testProject = createTestProject('doctor-project-fail');

            // Overwrite package.json with no @vendure/* deps
            testProject.writeFile(
                'package.json',
                JSON.stringify({
                    name: 'not-vendure',
                    version: '1.0.0',
                    dependencies: { express: '4.0.0' },
                }),
            );

            const result = await testProject.runCliCommand(
                ['doctor', '--check', 'project', '--format', 'json'],
                { expectError: true },
            );

            expect(result.exitCode).toBe(1);
            const report = JSON.parse(result.stdout);
            expect(report.overallStatus).toBe('failed');
            expect(report.checks[0].status).toBe('fail');
        });
    });

    describe('--format json', () => {
        it('should output valid JSON with all expected fields', async () => {
            testProject = createTestProject('doctor-json-output');

            const result = await testProject.runCliCommand([
                'doctor',
                '--check',
                'project',
                '--format',
                'json',
            ]);

            expect(result.exitCode).toBe(0);
            const report = JSON.parse(result.stdout);
            expect(report).toHaveProperty('nodeVersion');
            expect(report).toHaveProperty('checks');
            expect(report).toHaveProperty('overallStatus');
            expect(report.nodeVersion).toMatch(/^v\d+\.\d+\.\d+$/);
        });
    });

    describe('--strict mode', () => {
        it('should treat warnings as failures with --strict', async () => {
            testProject = createTestProject('doctor-strict');

            // Create node_modules with duplicate graphql versions to trigger a warn
            testProject.writeFile(
                'node_modules/graphql/package.json',
                JSON.stringify({ name: 'graphql', version: '16.11.0' }),
            );
            testProject.writeFile(
                'node_modules/some-pkg/node_modules/graphql/package.json',
                JSON.stringify({ name: 'graphql', version: '16.14.0' }),
            );
            // The test project config uses better-sqlite3, so we need to fake the driver
            testProject.writeFile(
                'node_modules/better-sqlite3/package.json',
                JSON.stringify({ name: 'better-sqlite3', version: '9.0.0' }),
            );

            // Without --strict, duplicate singletons are a warning and result is 'passed'
            const passResult = await testProject.runCliCommand(
                ['doctor', '--check', 'dependencies', '--format', 'json'],
                { expectError: true },
            );
            const passReport = JSON.parse(passResult.stdout);
            expect(passReport.overallStatus).toBe('passed');
            expect(passReport.checks[0].status).toBe('warn');
            expect(passResult.exitCode).toBe(0);

            // With --strict, the same warning causes a failure
            const failResult = await testProject.runCliCommand(
                ['doctor', '--check', 'dependencies', '--format', 'json', '--strict'],
                { expectError: true },
            );
            expect(failResult.exitCode).toBe(1);
            const failReport = JSON.parse(failResult.stdout);
            expect(failReport.overallStatus).toBe('failed');
        });
    });

    describe('--help', () => {
        it('should show doctor help with all options', async () => {
            testProject = createTestProject('doctor-help');

            const result = await testProject.runCliCommand(['doctor', '--help']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('--config');
            expect(result.stdout).toContain('--check');
            expect(result.stdout).toContain('--profile');
            expect(result.stdout).toContain('--format');
            expect(result.stdout).toContain('--strict');
        });
    });

    describe('dependency check', () => {
        it('should report when node_modules is missing', async () => {
            testProject = createTestProject('doctor-no-modules');

            // The default test project doesn't run npm install,
            // so node_modules won't exist
            const result = await testProject.runCliCommand(
                ['doctor', '--check', 'dependencies', '--format', 'json'],
                { expectError: true },
            );

            expect(result.exitCode).toBe(1);
            const report = JSON.parse(result.stdout);
            expect(report.checks[0].status).toBe('fail');
            expect(report.checks[0].message).toContain('node_modules not found');
        });
    });

    describe('cascading skips', () => {
        it('should skip config-dependent checks when project check fails', async () => {
            testProject = createTestProject('doctor-cascade-skip');

            // Overwrite package.json with no vendure deps
            testProject.writeFile(
                'package.json',
                JSON.stringify({
                    name: 'not-vendure',
                    version: '1.0.0',
                    dependencies: { express: '4.0.0' },
                }),
            );

            const result = await testProject.runCliCommand(
                ['doctor', '--format', 'json'],
                { expectError: true },
            );

            expect(result.exitCode).toBe(1);
            const report = JSON.parse(result.stdout);

            // Project should fail
            expect(report.checks[0].name).toBe('Project');
            expect(report.checks[0].status).toBe('fail');

            // All other checks should be skipped
            const skippedChecks = report.checks.filter((c: any) => c.status === 'skip');
            expect(skippedChecks.length).toBeGreaterThanOrEqual(4);
        });
    });
});
