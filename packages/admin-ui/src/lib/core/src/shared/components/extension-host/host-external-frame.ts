import { Route } from '@angular/router';

import { ExtensionHostConfig, ExtensionHostOptions } from './extension-host-config';
import { ExtensionHostComponent } from './extension-host.component';

export interface ExternalFrameOptions extends ExtensionHostOptions {
    path: string;
    breadcrumbLabel: string;
}

/**
 * This function is used to conveniently configure a UI extension route to
 * host an external URL from the Admin UI using the {@link ExtensionHostComponent}
 *
 * @example
 * ```ts
 * \@NgModule({
 *     imports: [
 *         RouterModule.forChild([
 *             hostExternalFrame({
 *                 path: '',
 *                 breadcrumbLabel: 'Vue.js App',
 *                 extensionUrl: './assets/vue-app/index.html',
 *                 openInNewTab: false,
 *             }),
 *         ]),
 *     ],
 * })
 export class VueUiExtensionModule {}
 * ```
 */
export function hostExternalFrame(options: ExternalFrameOptions): Route {
    const pathMatch = options.path === '' ? 'full' : 'prefix';
    return {
        path: options.path,
        pathMatch,
        component: ExtensionHostComponent,
        data: {
            breadcrumb: [
                {
                    label: options.breadcrumbLabel,
                    link: ['./'],
                },
            ],
            extensionHostConfig: new ExtensionHostConfig(options),
        },
    };
}
