import path from 'path';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import { defaultManipulationSettings } from '../../../../../constants';
import { VendurePluginRef } from '../../../../../shared/vendure-plugin-ref';
import { getPluginClasses } from '../../../../../utilities/ast-utils';
import { expectSourceFileContentToMatch } from '../../../../../utilities/testing-utils';

import { addUiExtensionStaticProp } from './add-ui-extension-static-prop';

describe('addUiExtensionStaticProp', () => {
    it('add ui prop and imports', { timeout: 30_000 }, () => {
        const project = new Project({
            manipulationSettings: defaultManipulationSettings,
        });
        project.addSourceFileAtPath(path.join(__dirname, 'fixtures', 'no-ui-prop.fixture.ts'));
        const pluginClasses = getPluginClasses(project);
        expect(pluginClasses.length).toBe(1);
        addUiExtensionStaticProp(new VendurePluginRef(pluginClasses[0]));

        expectSourceFileContentToMatch(
            pluginClasses[0].getSourceFile(),
            path.join(__dirname, 'fixtures', 'no-ui-prop.expected'),
        );
    });
});
