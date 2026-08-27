import fs from 'fs-extra';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { noopLogger } from '../utils/logger.js';
import { discoverPlugins } from '../utils/plugin-discovery.js';

// These snippets mirror TypeScript's direct and importHelpers decorator output.
const decoratorForms = [
    {
        name: 'direct __decorate',
        prelude: `import { VendurePlugin } from '@vendure/core';`,
        decorate: '__decorate',
        vendurePlugin: 'VendurePlugin',
        otherDecorator: 'OtherDecorator',
    },
    {
        name: 'tslib_1.__decorate',
        prelude: `const tslib_1 = require('tslib');\nconst core_1 = require('@vendure/core');\nconst other_1 = require('other-package');`,
        decorate: 'tslib_1.__decorate',
        vendurePlugin: '(0, core_1.VendurePlugin)',
        otherDecorator: '(0, other_1.OtherDecorator)',
    },
];

describe('plugin discovery', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(tempDir => fs.remove(tempDir)));
    });

    async function discoverFromCompiledSource({
        pluginNames,
        tsSource,
        compiledJs,
    }: {
        pluginNames: string[];
        tsSource: string;
        compiledJs: string;
    }) {
        const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'vendure-plugin-discovery-'));
        const outputPath = path.join(tempDir, 'dist');
        const vendureConfigPath = path.join(tempDir, 'vendure-config.ts');
        const pluginSourcePath = path.join(tempDir, 'plugins.ts');
        const pluginPath = path.join(outputPath, 'plugins.js');
        tempDirs.push(tempDir);

        await fs.outputFile(
            vendureConfigPath,
            `import { ${pluginNames.join(', ')} } from './plugins';\nexport const config = { plugins: [${pluginNames.join(', ')}] };`,
        );
        await fs.outputFile(pluginSourcePath, tsSource);
        await fs.outputFile(pluginPath, compiledJs);

        const plugins = await discoverPlugins({
            vendureConfigPath,
            transformTsConfigPathMappings: ({ patterns }) => patterns,
            logger: noopLogger,
            outputPath,
            pluginPackageScanner: {
                nodeModulesRoot: path.join(tempDir, 'node_modules'),
            },
        });

        return { pluginPath, pluginSourcePath, plugins };
    }

    // OSS-724: Each decorator call must emit its own matched plugin entry.
    it.each(decoratorForms)('discovers each plugin class with $name', async decoratorForm => {
        const { pluginPath, pluginSourcePath, plugins } = await discoverFromCompiledSource({
            pluginNames: ['FirstPlugin', 'SecondPlugin'],
            tsSource: `
                import { VendurePlugin } from '@vendure/core';
                @VendurePlugin({ dashboard: './dashboard/first.tsx' })
                export class FirstPlugin {}
                @VendurePlugin({ dashboard: { location: './dashboard/second.tsx' } })
                export class SecondPlugin {}
            `,
            compiledJs: `
                ${decoratorForm.prelude}
                FirstPlugin = ${decoratorForm.decorate}([
                    ${decoratorForm.vendurePlugin}({ dashboard: './dashboard/first.tsx' })
                ], FirstPlugin);
                SecondPlugin = ${decoratorForm.decorate}([
                    ${decoratorForm.vendurePlugin}({ dashboard: { location: './dashboard/second.tsx' } })
                ], SecondPlugin);
            `,
        });

        expect(plugins).toEqual([
            {
                name: 'FirstPlugin',
                pluginPath,
                dashboardEntryPath: './dashboard/first.tsx',
                sourcePluginPath: pluginSourcePath,
            },
            {
                name: 'SecondPlugin',
                pluginPath,
                dashboardEntryPath: './dashboard/second.tsx',
                sourcePluginPath: pluginSourcePath,
            },
        ]);
    });

    // OSS-724: A later class without a dashboard must not reuse an earlier path.
    it.each(decoratorForms)(
        'does not pair an earlier dashboard path with a later class using $name',
        async decoratorForm => {
            const { pluginPath, pluginSourcePath, plugins } = await discoverFromCompiledSource({
                pluginNames: ['FirstPlugin', 'SecondPlugin'],
                tsSource: `
                import { VendurePlugin } from '@vendure/core';
                @VendurePlugin({ dashboard: { location: './dashboard/first.tsx' } })
                export class FirstPlugin {}
                @VendurePlugin({})
                export class SecondPlugin {}
            `,
                compiledJs: `
                ${decoratorForm.prelude}
                FirstPlugin = ${decoratorForm.decorate}([
                    ${decoratorForm.vendurePlugin}({ dashboard: { location: './dashboard/first.tsx' } })
                ], FirstPlugin);
                SecondPlugin = ${decoratorForm.decorate}([
                    ${decoratorForm.vendurePlugin}({})
                ], SecondPlugin);
            `,
            });

            expect(plugins).toEqual([
                {
                    name: 'FirstPlugin',
                    pluginPath,
                    dashboardEntryPath: './dashboard/first.tsx',
                    sourcePluginPath: pluginSourcePath,
                },
            ]);
        },
    );

    // OSS-724: Dashboard metadata from other decorators must be ignored.
    it.each(decoratorForms)('ignores non-Vendure decorators with $name', async decoratorForm => {
        const { pluginPath, pluginSourcePath, plugins } = await discoverFromCompiledSource({
            pluginNames: ['VendureDashboardPlugin', 'OtherDashboardClass'],
            tsSource: `
                import { VendurePlugin } from '@vendure/core';
                import { OtherDecorator } from 'other-package';
                @VendurePlugin({ dashboard: './dashboard/vendure.tsx' })
                export class VendureDashboardPlugin {}
                @OtherDecorator({ dashboard: './dashboard/other.tsx' })
                export class OtherDashboardClass {}
            `,
            compiledJs: `
                ${decoratorForm.prelude}
                VendureDashboardPlugin = ${decoratorForm.decorate}([
                    ${decoratorForm.vendurePlugin}({ dashboard: './dashboard/vendure.tsx' })
                ], VendureDashboardPlugin);
                OtherDashboardClass = ${decoratorForm.decorate}([
                    ${decoratorForm.otherDecorator}({ dashboard: './dashboard/other.tsx' })
                ], OtherDashboardClass);
            `,
        });

        expect(plugins).toEqual([
            {
                name: 'VendureDashboardPlugin',
                pluginPath,
                dashboardEntryPath: './dashboard/vendure.tsx',
                sourcePluginPath: pluginSourcePath,
            },
        ]);
    });
});
