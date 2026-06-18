import { Type } from '@angular/core';
import { Subject } from 'rxjs';
import { BreadcrumbValue } from '../providers/breadcrumb/breadcrumb.service';

export interface RouteComponentOptions {
    component: any;
    title$: Subject<string | undefined>;
    breadcrumb$: Subject<BreadcrumbValue>;
}

export interface AngularRouteComponentOptions extends RouteComponentOptions {
    component: Type<any>;
}
