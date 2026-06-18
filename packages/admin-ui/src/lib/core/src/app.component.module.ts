import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { CoreModule } from './core.module';
import { SharedModule } from './shared/shared.module';

@NgModule({
    imports: [SharedModule, CoreModule],
    declarations: [AppComponent],
    exports: [AppComponent],
})
export class AppComponentModule {}
