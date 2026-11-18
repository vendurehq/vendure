import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProjectTree, packageFiles, removeProjectTrees } from '../../../shared/__tests__/project-tree.js';

import { runSchemaCheck } from './schema-check.js';

describe('runSchemaCheck()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        removeProjectTrees();
    });

    // #5755 — @nestjs/graphql is a dependency of @vendure/core, so a strict install
    // places it under core rather than at the project root
    it('builds the schemas with the @nestjs/graphql installed under the project @vendure/core', async () => {
        const root = createProjectTree({
            'package.json': JSON.stringify({ dependencies: { '@vendure/core': '3.8.1' } }),
            ...packageFiles(
                'node_modules/@vendure/core',
                '@vendure/core',
                `exports.VENDURE_ADMIN_API_TYPE_PATHS = [];
                exports.VENDURE_SHOP_API_TYPE_PATHS = [];
                exports.getFinalVendureSchema = async ({ typesLoader }) => {
                    if (!typesLoader.fromCoreCopy) throw new Error('wrong @nestjs/graphql');
                    return {};
                };`,
            ),
            ...packageFiles(
                'node_modules/@vendure/core/node_modules/@nestjs/graphql',
                '@nestjs/graphql',
                `exports.GraphQLTypesLoader = class { constructor() { this.fromCoreCopy = true; } };`,
            ),
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const result = await runSchemaCheck({} as any);

        expect(result.details).toEqual([
            'Admin API schema validated successfully',
            'Shop API schema validated successfully',
        ]);
        expect(result.status).toBe('pass');
    });
});
