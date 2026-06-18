import { AdminUiExtension } from '@vendure/ui-devkit/compiler';
import path from 'path';

export class UiExtensionsLibraryPlugin {
    static uiExtensions: AdminUiExtension = {
        id: 'ui-extensions-library',
        extensionPath: path.join(__dirname, 'ui'),
        routes: [{ route: 'ui-library', filePath: 'routes.ts' }],
        providers: ['providers.ts'],
    };
}
