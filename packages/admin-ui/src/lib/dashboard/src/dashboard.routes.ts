import { Routes } from '@angular/router';

import { DashboardComponent } from './components/dashboard/dashboard.component';

export const dashboardRoutes: Routes = [
    {
        path: '',
        component: DashboardComponent,
        pathMatch: 'full',
    },
];
