/* eslint-disable @typescript-eslint/no-non-null-assertion */
import path from 'path';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import { defaultManipulationSettings } from '../../../../../constants';
import { VendurePluginRef } from '../../../../../shared/vendure-plugin-ref';
import { createFile, getPluginClasses } from '../../../../../utilities/ast-utils';
import { expectSourceFileContentToMatch } from '../../../../../utilities/testing-utils';

import { addEntityToPlugin } from './add-entity-to-plugin';

describe('addEntityToPlugin', () => {
    function testAddEntityToPlugin(options: { fixtureFileName: string; expectedFileName: string }) {
        const project = new Project({
            manipulationSettings: defaultManipulationSettings,
        });
        project.addSourceFileAtPath(path.join(__dirname, 'fixtures', options.fixtureFileName));
        const pluginClasses = getPluginClasses(project);
        expect(pluginClasses.length).toBe(1);
        const entityTemplatePath = path.join(__dirname, '../../templates/entity.template.ts');
        const entityFile = createFile(
            project,
            entityTemplatePath,
            path.join(__dirname, 'fixtures', 'entity.ts'),
        );
        const entityClass = entityFile.getClass('ScaffoldEntity');
        addEntityToPlugin(new VendurePluginRef(pluginClasses[0]), entityClass!);

        expectSourceFileContentToMatch(
            pluginClasses[0].getSourceFile(),
            path.join(__dirname, 'fixtures', options.expectedFileName),
        );
    }

    it('creates entity prop and imports', { timeout: 30_000 }, () => {
        testAddEntityToPlugin({
            fixtureFileName: 'no-entity-prop.fixture.ts',
            expectedFileName: 'no-entity-prop.expected',
        });
    });

    it('adds to existing entity prop and imports', { timeout: 30_000 }, () => {
        testAddEntityToPlugin({
            fixtureFileName: 'existing-entity-prop.fixture.ts',
            expectedFileName: 'existing-entity-prop.expected',
        });
    });

    it('throws error when entity class is null', { timeout: 30_000 }, () => {
        const project = new Project({
            manipulationSettings: defaultManipulationSettings,
        });
        project.addSourceFileAtPath(path.join(__dirname, 'fixtures', 'no-entity-prop.fixture.ts'));
        const pluginClasses = getPluginClasses(project);
        const vendurePlugin = new VendurePluginRef(pluginClasses[0]);

        expect(() => addEntityToPlugin(vendurePlugin, null as any)).toThrow('Could not find entity class');
    });

    it('throws error when entity class is undefined', { timeout: 30_000 }, () => {
        const project = new Project({
            manipulationSettings: defaultManipulationSettings,
        });
        project.addSourceFileAtPath(path.join(__dirname, 'fixtures', 'no-entity-prop.fixture.ts'));
        const pluginClasses = getPluginClasses(project);
        const vendurePlugin = new VendurePluginRef(pluginClasses[0]);

        expect(() => addEntityToPlugin(vendurePlugin, undefined as any)).toThrow(
            'Could not find entity class',
        );
    });

    it('adds entity and import to plugin successfully', { timeout: 30_000 }, () => {
        const project = new Project({
            manipulationSettings: defaultManipulationSettings,
        });
        project.addSourceFileAtPath(path.join(__dirname, 'fixtures', 'no-entity-prop.fixture.ts'));
        const pluginClasses = getPluginClasses(project);
        const entityTemplatePath = path.join(__dirname, '../../templates/entity.template.ts');
        const entityFile = createFile(
            project,
            entityTemplatePath,
            path.join(__dirname, 'fixtures', 'entity.ts'),
        );
        const entityClass = entityFile.getClass('ScaffoldEntity');
        const vendurePlugin = new VendurePluginRef(pluginClasses[0]);

        // Execute the function
        addEntityToPlugin(vendurePlugin, entityClass!);

        // Verify the plugin metadata was updated
        const entities = vendurePlugin.getMetadataOptions().getProperty('entities');
        expect(entities).toBeDefined();

        // Verify the import was added
        const sourceFile = pluginClasses[0].getSourceFile();
        const importDeclaration = sourceFile
            .getImportDeclarations()
            .find(imp =>
                imp.getNamedImports().some(namedImport => namedImport.getName() === 'ScaffoldEntity'),
            );
        expect(importDeclaration).toBeDefined();
    });
});
