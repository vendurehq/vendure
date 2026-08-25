import { MigrationDiagnostic } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { buildMigrationReport } from './migration-report';

const unmatched: MigrationDiagnostic = {
    type: 'no-migrations-matched',
    patterns: ['dist/migrations/*.js'],
    cwd: '/project',
};
const outOfSync: MigrationDiagnostic = {
    type: 'schema-out-of-sync',
    queries: ['ALTER TABLE `product` ADD `foo` varchar(255)'],
};

describe('buildMigrationReport()', () => {
    it('reports the number of migrations that ran', () => {
        const report = buildMigrationReport(['1700000000000-first', '1700000000001-second'], []);

        expect(report.summary).toBe('Successfully ran 2 migrations');
        expect(report.message).toBe('Successfully ran 2 migrations');
        expect(report.hasWarnings).toBe(false);
    });

    it('reports no pending migrations when nothing ran and nothing was diagnosed', () => {
        const report = buildMigrationReport([], []);

        expect(report.summary).toBe('No pending migrations found');
        expect(report.hasWarnings).toBe(false);
    });

    // #5001 — an empty result caused by unmatched patterns must not read as "up to date"
    it('does not claim there are no pending migrations when the patterns matched nothing', () => {
        const report = buildMigrationReport([], [unmatched]);

        expect(report.summary).toBe('No migration files could be loaded');
        expect(report.message).not.toContain('No pending migrations found');
        expect(report.details).toContain('dist/migrations/*.js');
        expect(report.details).toContain('/project');
        expect(report.hasWarnings).toBe(true);
    });

    it('appends the schema drift warning to the summary', () => {
        const report = buildMigrationReport(['1700000000000-first'], [outOfSync]);

        expect(report.summary).toBe('Successfully ran 1 migrations');
        expect(report.message).toContain('Successfully ran 1 migrations');
        expect(report.details).toContain('does not match your current configuration');
        expect(report.details).toContain('ALTER TABLE `product` ADD `foo` varchar(255)');
        expect(report.hasWarnings).toBe(true);
    });

    it('renders every diagnostic', () => {
        const report = buildMigrationReport([], [unmatched, outOfSync]);

        expect(report.details).toContain('dist/migrations/*.js');
        expect(report.details).toContain('does not match your current configuration');
    });
});
