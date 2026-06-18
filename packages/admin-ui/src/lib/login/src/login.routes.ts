import { Routes } from '@angular/router';

import { LoginComponent } from './components/login/login.component';
import { LoginGuard } from './providers/login.guard';

export const loginRoutes: Routes = [
    {
        path: '',
        component: LoginComponent,
        pathMatch: 'full',
        canActivate: [LoginGuard],
    },
];
