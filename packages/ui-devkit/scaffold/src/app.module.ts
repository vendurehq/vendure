import { NgModule } from '@angular/core';
import { Route, RouterModule } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { AppComponent, AppComponentModule, CoreModule } from '@vendure/admin-ui/core';

import { routes } from './app.routes';
import { SharedExtensionsModule } from './shared-extensions.module';

@NgModule({
    declarations: [],
    imports: [
        AppComponentModule,
        RouterModule.forRoot(routes, { useHash: false }),
        CoreModule,
        SharedExtensionsModule,
    ],
    bootstrap: [AppComponent],
})
export class AppModule {}
