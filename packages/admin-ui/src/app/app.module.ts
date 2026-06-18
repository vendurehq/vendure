import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AppComponent, AppComponentModule } from '@vendure/admin-ui/core';

import { routes } from './app.routes';

@NgModule({
    declarations: [],
    imports: [CommonModule, AppComponentModule, RouterModule.forRoot(routes, { useHash: false })],
    providers: [],
    bootstrap: [AppComponent],
})
export class AppModule {}
