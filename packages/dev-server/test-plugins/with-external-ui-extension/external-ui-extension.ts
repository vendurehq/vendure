import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { hostExternalFrame } from '@vendure/admin-ui/core';

@NgModule({
    imports: [
        RouterModule.forChild([
            hostExternalFrame({
                path: '',
                breadcrumbLabel: 'Test',
                extensionUrl: './assets/external-app/index.html',
                openInNewTab: false,
            }),
        ]),
    ],
})
export class ExternalUiExtensionModule {}
