import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { loadAppConfig } from '@vendure/admin-ui/core';

import { AppModule } from './app.module';
import { environment } from './environment';

if (environment.production) {
    enableProdMode();
}

loadAppConfig()
    .then(() => platformBrowserDynamic().bootstrapModule(AppModule))
    .catch((err: any) => {
        /* eslint-disable no-console */
        console.log(err);
    });
