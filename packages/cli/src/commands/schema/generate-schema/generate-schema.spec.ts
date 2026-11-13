import { log } from '@clack/prompts';
import { VendurePlugin } from '@vendure/core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file.js';

import { generateSchema } from './generate-schema.js';

vi.mock('@clack/prompts', () => ({
    log: {
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../../shared/shared-prompts.js', () => ({
    analyzeProject: vi.fn(async () => ({ project: {}, vendureTsConfig: undefined })),
}));

vi.mock('../../../shared/vendure-config-ref.js', () => ({
    // A `function` (not an arrow function) because the code under test calls it with `new`.
    VendureConfigRef: vi.fn(function () {
        return { getPathRelativeToProjectRoot: () => 'vendure-config.ts' };
    }),
}));

vi.mock('../../../shared/load-vendure-config-file.js', () => ({
    loadVendureConfigFile: vi.fn(),
}));

// Use the workspace packages as the "project" copies, so that the plugins below and the
// schema generator share one `@vendure/core`.
vi.mock('../../../shared/project-core.js', () => ({
    requireProjectCore: () => require('@vendure/core'),
    requireFromProject: (packageName: string) => require(packageName),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parse } = require('graphql');

@VendurePlugin({
    adminApiExtensions: {
        schema: parse(`
            type ComposedChildType {
                id: ID!
            }
            extend type Query {
                composedChild: ComposedChildType
            }
        `),
    },
    configuration: config => {
        config.customFields.Product.push({ name: 'composedChildField', type: 'string' });
        return config;
    },
})
class ChildPlugin {}

@VendurePlugin({
    plugins: [ChildPlugin],
    adminApiExtensions: {
        schema: parse(`
            extend type ComposedChildType {
                parentField: String
            }
        `),
    },
})
class ParentPlugin {}

describe('generateSchema()', () => {
    let outputDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        outputDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-schema-'));
    });

    afterEach(() => {
        rmSync(outputDir, { recursive: true, force: true });
    });

    // #5430 — the schema command does not use preBootstrapConfig, so it receives the
    // plugin list before composed plugins are flattened into it.
    it('includes the API extensions and configuration of composed plugins', async () => {
        vi.mocked(loadVendureConfigFile).mockResolvedValue({
            apiOptions: {},
            authOptions: {},
            dbConnectionOptions: { type: 'better-sqlite3' },
            plugins: [{ module: ParentPlugin }],
        } as any);

        await generateSchema({ api: 'admin', outputDir });

        expect(log.error).not.toHaveBeenCalled();
        const schema = readFileSync(path.join(outputDir, 'schema.graphql'), 'utf-8');
        expect(schema).toContain('composedChild: ComposedChildType');
        expect(schema).toMatch(/type ComposedChildType \{[^}]*parentField: String/);
        expect(schema).toContain('composedChildField: String');
    });
});
