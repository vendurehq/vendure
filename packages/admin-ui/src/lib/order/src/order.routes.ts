import { Route } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { PageComponent, PageService } from '@vendure/admin-ui/core';
import { OrderGuard } from './providers/routing/order.guard';

export const createRoutes = (pageService: PageService): Route[] => [
    {
        path: '',
        component: PageComponent,
        data: {
            locationId: 'order-list',
            breadcrumb: _('breadcrumb.orders'),
        },
        children: pageService.getPageTabRoutes('order-list'),
    },
    {
        path: 'draft/:id',
        component: PageComponent,
        canActivate: [OrderGuard],
        data: {
            locationId: 'draft-order-detail',
            breadcrumb: { label: _('breadcrumb.orders'), link: ['../'] },
        },
        children: pageService.getPageTabRoutes('draft-order-detail'),
    },
    {
        path: ':id',
        component: PageComponent,
        canActivate: [OrderGuard],
        data: {
            locationId: 'order-detail',
            breadcrumb: { label: _('breadcrumb.orders'), link: ['../'] },
        },
        children: pageService.getPageTabRoutes('order-detail'),
    },
    {
        path: ':aggregateOrderId/seller-orders/:id',
        component: PageComponent,
        canActivate: [OrderGuard],
        data: {
            locationId: 'order-detail',
            breadcrumb: { label: _('breadcrumb.orders'), link: ['../'] },
        },
        children: pageService.getPageTabRoutes('order-detail'),
    },
    {
        path: ':id/modify',
        component: PageComponent,
        canActivate: [OrderGuard],
        data: {
            locationId: 'modify-order',
            breadcrumb: { label: _('breadcrumb.orders'), link: ['../'] },
        },
        children: pageService.getPageTabRoutes('modify-order'),
    },
];
