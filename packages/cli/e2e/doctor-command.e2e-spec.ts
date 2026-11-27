import { afterEach, describe, expect, it } from 'vitest';

import { CliTestProject, createTestProject } from './cli-test-utils.js';

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
            const report = JSON.parse(result.stdout).output;
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
            const report = JSON.parse(result.stdout).output;
            expect(report.overallStatus).toBe('failed');
            expect(report.checks[0].status).toBe('fail');
        });
    });

    describe('--json', () => {
        it('should write one envelope to stdout, with the report as its output', async () => {
            testProject = createTestProject('doctor-envelope');

            const result = await testProject.runCliCommand(['doctor', '--check', 'project', '--json']);

            const envelope = JSON.parse(result.stdout);
            expect(envelope).toMatchObject({ schemaVersion: 1, status: 'ok', notices: [] });
            expect(envelope.output.overallStatus).toBe('passed');
        });

        it('should return status failed and a non-zero exit code when a check fails', async () => {
            testProject = createTestProject('doctor-envelope-failed');
            testProject.writeFile(
                'package.json',
                JSON.stringify({ name: 'not-vendure', version: '1.0.0', dependencies: { express: '4.0.0' } }),
            );

            const result = await testProject.runCliCommand(['doctor', '--check', 'project', '--json'], {
                expectError: true,
            });

            expect(result.exitCode).toBe(1);
            const envelope = JSON.parse(result.stdout);
            expect(envelope.status).toBe('failed');
            expect(envelope.output.checks[0].status).toBe('fail');
        });

        it('should accept the whole input through --input', async () => {
            testProject = createTestProject('doctor-input');

            const result = await testProject.runCliCommand([
                'doctor',
                '--input',
                '{"check":["project"]}',
                '--json',
            ]);

            expect(JSON.parse(result.stdout).output.checks).toHaveLength(1);
        });

        it('should tag its events on stderr and collect its notices into the envelope', async () => {
            testProject = createTestProject('doctor-notices');

            const result = await testProject.runCliCommand([
                'doctor',
                '--check',
                'project',
                '--check',
                'bogus',
                '--json',
            ]);

            const envelope = JSON.parse(result.stdout);
            expect(envelope.notices).toEqual([
                { level: 'warning', message: expect.stringContaining('Unknown check(s): bogus') },
            ]);
            const events = result.stderr
                .split('\n')
                .filter(line => line.startsWith('{'))
                .map(line => JSON.parse(line));
            expect(events).toContainEqual(
                expect.objectContaining({ vendure: 'event', type: 'notice', level: 'warning' }),
            );
        });

        it('should report a bad flag as an error envelope', async () => {
            testProject = createTestProject('doctor-bad-flag');

            const result = await testProject.runCliCommand(['doctor', '--nope', '--json'], {
                expectError: true,
            });

            expect(result.exitCode).toBe(1);
            expect(JSON.parse(result.stdout)).toMatchObject({
                status: 'error',
                error: { code: 'cli.usage' },
            });
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
            const report = JSON.parse(result.stdout).output;
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
            const passReport = JSON.parse(passResult.stdout).output;
            expect(passReport.overallStatus).toBe('passed');
            expect(passReport.checks[0].status).toBe('warn');
            expect(passResult.exitCode).toBe(0);

            // With --strict, the same warning causes a failure
            const failResult = await testProject.runCliCommand(
                ['doctor', '--check', 'dependencies', '--format', 'json', '--strict'],
                { expectError: true },
            );
            expect(failResult.exitCode).toBe(1);
            const failReport = JSON.parse(failResult.stdout).output;
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
            expect(result.stdout).toContain('--json');
            expect(result.stdout).toContain('--input');
            expect(result.stdout).toContain('--strict');
        });
    });

    describe('dependency check', () => {
        it('should report when node_modules is missing', async () => {
            testProject = createTestProject('doctor-no-modules');

            // The default test project doesn't run npm install,
            // so node_modules won't exist and no packages are resolvable
            const result = await testProject.runCliCommand(
                ['doctor', '--check', 'dependencies', '--format', 'json'],
                { expectError: true },
            );

            expect(result.exitCode).toBe(1);
            const report = JSON.parse(result.stdout).output;
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

            const result = await testProject.runCliCommand(['doctor', '--format', 'json'], {
                expectError: true,
            });

            expect(result.exitCode).toBe(1);
            const report = JSON.parse(result.stdout).output;

            // Project should fail
            expect(report.checks[0].name).toBe('Project');
            expect(report.checks[0].status).toBe('fail');

            // All other checks should be skipped
            const skippedChecks = report.checks.filter((c: any) => c.status === 'skip');
            expect(skippedChecks.length).toBeGreaterThanOrEqual(4);
        });
    });
});
