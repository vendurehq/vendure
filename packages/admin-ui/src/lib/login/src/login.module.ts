import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@vendure/admin-ui/core';

import { LoginComponent } from './components/login/login.component';
import { loginRoutes } from './login.routes';

@NgModule({
    imports: [SharedModule, RouterModule.forChild(loginRoutes)],
    exports: [],
    declarations: [LoginComponent],
})
export class LoginModule {}
