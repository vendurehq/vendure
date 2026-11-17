import { log } from '@clack/prompts';
import { VendurePlugin } from '@vendure/core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectTree, packageFiles, removeProjectTrees } from '../../../shared/__tests__/project-tree';
import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file';

import { generateSchema } from './generate-schema';

vi.mock('@clack/prompts', () => ({
    log: {
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../../shared/shared-prompts', () => ({
    analyzeProject: vi.fn(async () => ({ project: {}, vendureTsConfig: undefined })),
}));

vi.mock('../../../shared/vendure-config-ref', () => ({
    VendureConfigRef: vi.fn(() => ({ getPathRelativeToProjectRoot: () => 'vendure-config.ts' })),
}));

vi.mock('../../../shared/load-vendure-config-file', () => ({
    loadVendureConfigFile: vi.fn(),
}));

const projectCoreMode = vi.hoisted(() => ({ useRealProject: false }));

// Use the workspace packages as the "project" copies, so that the plugins below and the
// schema generator share one `@vendure/core`. Tests that build a project on disk set
// `useRealProject` to resolve from it instead.
vi.mock('../../../shared/project-core', async importActual => {
    const actual = await importActual<typeof import('../../../shared/project-core')>();
    return {
        requireProjectCore: (cwd?: string) =>
            projectCoreMode.useRealProject ? actual.requireProjectCore(cwd) : require('@vendure/core'),
        requireFromProject: (packageName: string, cwd?: string) =>
            projectCoreMode.useRealProject
                ? actual.requireFromProject(packageName, cwd)
                : require(packageName),
        requireFromProjectCore: (packageName: string, cwd?: string) =>
            projectCoreMode.useRealProject
                ? actual.requireFromProjectCore(packageName, cwd)
                : require(packageName),
    };
});

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
        projectCoreMode.useRealProject = false;
        vi.restoreAllMocks();
        removeProjectTrees();
        rmSync(outputDir, { recursive: true, force: true });
    });

    // #5755 — graphql and @nestjs/graphql are dependencies of @vendure/core, so a strict
    // install places them under core rather than at the project root
    it('prints the schema with the graphql installed under the project @vendure/core', async () => {
        const root = createProjectTree({
            'package.json': JSON.stringify({ dependencies: { '@vendure/core': '3.8.1' } }),
            ...packageFiles(
                'node_modules/@vendure/core',
                '@vendure/core',
                `let config;
                exports.VENDURE_ADMIN_API_TYPE_PATHS = [];
                exports.VENDURE_SHOP_API_TYPE_PATHS = [];
                exports.resetConfig = () => { config = undefined; };
                exports.setConfig = async c => { config = c; };
                exports.getConfig = () => config;
                exports.runPluginConfigurations = async c => c;
                exports.getFinalVendureSchema = async ({ typesLoader }) => {
                    if (!typesLoader.fromCoreCopy) throw new Error('wrong @nestjs/graphql');
                    return { name: 'core-schema' };
                };`,
            ),
            ...packageFiles(
                'node_modules/@vendure/core/node_modules/graphql',
                'graphql',
                `exports.printSchema = schema => 'printed ' + schema.name + ' with the core copy of graphql';
                exports.getIntrospectionQuery = () => '';
                exports.graphqlSync = () => ({ data: {} });`,
            ),
            ...packageFiles(
                'node_modules/@vendure/core/node_modules/@nestjs/graphql',
                '@nestjs/graphql',
                `exports.GraphQLTypesLoader = class { constructor() { this.fromCoreCopy = true; } };`,
            ),
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        projectCoreMode.useRealProject = true;
        vi.mocked(loadVendureConfigFile).mockResolvedValue({} as any);

        await generateSchema({ api: 'admin', outputDir });

        expect(log.error).not.toHaveBeenCalled();
        expect(readFileSync(path.join(outputDir, 'schema.graphql'), 'utf-8')).toBe(
            'printed core-schema with the core copy of graphql',
        );
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
