import path from 'path';
import { Project } from 'ts-morph';
import { describe, it } from 'vitest';

import { defaultManipulationSettings } from '../../../../../constants';
import { VendureConfigRef } from '../../../../../shared/vendure-config-ref';
import { expectSourceFileContentToMatch } from '../../../../../utilities/testing-utils';

import { updateAdminUiPluginInit } from './update-admin-ui-plugin-init';

describe('updateAdminUiPluginInit', () => {
    it('adds app prop', { timeout: 30_000 }, () => {
        const project = new Project({
            manipulationSettings: defaultManipulationSettings,
        });
        project.addSourceFileAtPath(path.join(__dirname, 'fixtures', 'no-app-prop.fixture.ts'));
        const vendureConfig = new VendureConfigRef(project);
        updateAdminUiPluginInit(vendureConfig, {
            pluginClassName: 'TestPlugin',
            pluginPath: './plugins/test-plugin/test.plugin',
        });

        expectSourceFileContentToMatch(
            project.getSourceFiles()[0],
            path.join(__dirname, 'fixtures', 'no-app-prop.expected'),
        );
    });

    // TODO: figure out why failing in CI but passing locally
    it.skip('adds to existing ui extensions array', () => {
        const project = new Project({
            manipulationSettings: defaultManipulationSettings,
        });
        project.addSourceFileAtPath(path.join(__dirname, 'fixtures', 'existing-app-prop.fixture.ts'));
        const vendureConfig = new VendureConfigRef(project);
        updateAdminUiPluginInit(vendureConfig, {
            pluginClassName: 'TestPlugin',
            pluginPath: './plugins/test-plugin/test.plugin',
        });

        expectSourceFileContentToMatch(
            project.getSourceFiles()[0],
            path.join(__dirname, 'fixtures', 'existing-app-prop.expected'),
        );
    });
});
