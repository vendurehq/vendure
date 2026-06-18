import { paramCase } from 'change-case';

import { AdminUiExtensionTypeName } from '../../../../../constants';
import { VendurePluginRef } from '../../../../../shared/vendure-plugin-ref';
import { addImportsToFile } from '../../../../../utilities/ast-utils';

/**
 * @description
 * Adds the static `ui` property to the plugin class, and adds the required imports.
 */
export function addUiExtensionStaticProp(plugin: VendurePluginRef) {
    const pluginClass = plugin.classDeclaration;
    const adminUiExtensionType = AdminUiExtensionTypeName;
    const extensionId = paramCase(pluginClass.getName() as string).replace(/-plugin$/, '');
    pluginClass
        .addProperty({
            name: 'ui',
            isStatic: true,
            type: adminUiExtensionType,
            initializer: `{
                        id: '${extensionId}-ui',
                        extensionPath: path.join(__dirname, 'ui'),
                        routes: [{ route: '${extensionId}', filePath: 'routes.ts' }],
                        providers: ['providers.ts'],
                    }`,
        })
        .formatText();

    // Add the AdminUiExtension import if it doesn't already exist
    addImportsToFile(pluginClass.getSourceFile(), {
        moduleSpecifier: '@vendure/ui-devkit/compiler',
        namedImports: [adminUiExtensionType],
        order: 0,
    });

    // Add the path import if it doesn't already exist
    addImportsToFile(pluginClass.getSourceFile(), {
        moduleSpecifier: 'path',
        namespaceImport: 'path',
        order: 0,
    });
}
