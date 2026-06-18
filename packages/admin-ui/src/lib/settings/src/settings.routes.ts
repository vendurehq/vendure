import { inject } from '@angular/core';
import { Route } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    GetGlobalSettingsDetailDocument,
    GetProfileDetailDocument,
    PageComponent,
    PageService,
} from '@vendure/admin-ui/core';
import { of } from 'rxjs';

export const createRoutes = (pageService: PageService): Route[] => [
    {
        path: 'profile',
        component: PageComponent,
        data: {
            breadcrumb: _('breadcrumb.profile'),
        },
        resolve: {
            detail: () =>
                inject(DataService)
                    .query(GetProfileDetailDocument)
                    .mapSingle(data => ({ entity: of(data.activeAdministrator) })),
        },
        children: pageService.getPageTabRoutes('profile'),
    },
    {
        path: 'administrators',
        component: PageComponent,
        data: {
            locationId: 'administrator-list',
            breadcrumb: _('breadcrumb.administrators'),
        },
        children: pageService.getPageTabRoutes('administrator-list'),
    },
    {
        path: 'administrators/:id',
        component: PageComponent,
        data: {
            locationId: 'administrator-detail',
            breadcrumb: { label: _('breadcrumb.administrators'), link: ['../', 'administrators'] },
        },
        children: pageService.getPageTabRoutes('administrator-detail'),
    },
    {
        path: 'channels',
        component: PageComponent,
        data: {
            locationId: 'channel-list',
            breadcrumb: _('breadcrumb.channels'),
        },
        children: pageService.getPageTabRoutes('channel-list'),
    },
    {
        path: 'channels/:id',
        component: PageComponent,
        data: {
            locationId: 'channel-detail',
            breadcrumb: { label: _('breadcrumb.channels'), link: ['../', 'channels'] },
        },
        children: pageService.getPageTabRoutes('channel-detail'),
    },
    {
        path: 'stock-locations',
        component: PageComponent,
        data: {
            locationId: 'stock-location-list',
            breadcrumb: _('breadcrumb.stock-locations'),
        },
        children: pageService.getPageTabRoutes('stock-location-list'),
    },
    {
        path: 'stock-locations/:id',
        component: PageComponent,
        data: {
            locationId: 'stock-location-detail',
            breadcrumb: { label: _('breadcrumb.stock-locations'), link: ['../', 'stock-locations'] },
        },
        children: pageService.getPageTabRoutes('stock-location-detail'),
    },
    {
        path: 'sellers',
        component: PageComponent,
        data: {
            locationId: 'seller-list',
            breadcrumb: _('breadcrumb.sellers'),
        },
        children: pageService.getPageTabRoutes('seller-list'),
    },
    {
        path: 'sellers/:id',
        component: PageComponent,
        data: {
            locationId: 'seller-detail',
            breadcrumb: { label: _('breadcrumb.sellers'), link: ['../', 'sellers'] },
        },
        children: pageService.getPageTabRoutes('seller-detail'),
    },
    {
        path: 'roles',
        component: PageComponent,
        data: {
            locationId: 'role-list',
            breadcrumb: _('breadcrumb.roles'),
        },
        children: pageService.getPageTabRoutes('role-list'),
    },
    {
        path: 'roles/:id',
        component: PageComponent,
        data: {
            locationId: 'role-detail',
            breadcrumb: { label: _('breadcrumb.roles'), link: ['../', 'roles'] },
        },
        children: pageService.getPageTabRoutes('role-detail'),
    },
    {
        path: 'tax-categories',
        component: PageComponent,
        data: {
            locationId: 'tax-category-list',
            breadcrumb: _('breadcrumb.tax-categories'),
        },
        children: pageService.getPageTabRoutes('tax-category-list'),
    },
    {
        path: 'tax-categories/:id',
        component: PageComponent,
        data: {
            locationId: 'tax-category-detail',
            breadcrumb: { label: _('breadcrumb.tax-categories'), link: ['../', 'tax-categories'] },
        },
        children: pageService.getPageTabRoutes('tax-category-detail'),
    },
    {
        path: 'tax-rates',
        component: PageComponent,
        data: {
            locationId: 'tax-rate-list',
            breadcrumb: _('breadcrumb.tax-rates'),
        },
        children: pageService.getPageTabRoutes('tax-rate-list'),
    },
    {
        path: 'tax-rates/:id',
        component: PageComponent,
        data: {
            locationId: 'tax-rate-detail',
            breadcrumb: { label: _('breadcrumb.tax-rates'), link: ['../', 'tax-rates'] },
        },
        children: pageService.getPageTabRoutes('tax-rate-detail'),
    },
    {
        path: 'countries',
        component: PageComponent,
        data: {
            locationId: 'country-list',
            breadcrumb: _('breadcrumb.countries'),
        },
        children: pageService.getPageTabRoutes('country-list'),
    },
    {
        path: 'countries/:id',
        component: PageComponent,
        data: {
            locationId: 'country-detail',
            breadcrumb: { label: _('breadcrumb.countries'), link: ['../', 'countries'] },
        },
        children: pageService.getPageTabRoutes('country-detail'),
    },
    {
        path: 'zones',
        component: PageComponent,
        data: {
            locationId: 'zone-list',
            breadcrumb: _('breadcrumb.zones'),
        },
        children: pageService.getPageTabRoutes('zone-list'),
    },
    {
        path: 'zones/:id',
        component: PageComponent,
        data: {
            locationId: 'zone-detail',
            breadcrumb: { label: _('breadcrumb.zones'), link: ['../', 'zones'] },
        },
        children: pageService.getPageTabRoutes('zone-detail'),
    },
    {
        path: 'shipping-methods',
        component: PageComponent,
        data: {
            locationId: 'shipping-method-list',
            breadcrumb: _('breadcrumb.shipping-methods'),
        },
        children: pageService.getPageTabRoutes('shipping-method-list'),
    },
    {
        path: 'shipping-methods/:id',
        component: PageComponent,
        data: {
            locationId: 'shipping-method-detail',
            breadcrumb: { label: _('breadcrumb.shipping-methods'), link: ['../', 'shipping-methods'] },
        },
        children: pageService.getPageTabRoutes('shipping-method-detail'),
    },
    {
        path: 'payment-methods',
        component: PageComponent,
        data: {
            locationId: 'payment-method-list',
            breadcrumb: _('breadcrumb.payment-methods'),
        },
        children: pageService.getPageTabRoutes('payment-method-list'),
    },
    {
        path: 'payment-methods/:id',
        component: PageComponent,
        data: {
            locationId: 'payment-method-detail',
            breadcrumb: { label: _('breadcrumb.payment-methods'), link: ['../', 'payment-methods'] },
        },
        children: pageService.getPageTabRoutes('payment-method-detail'),
    },
    {
        path: 'global-settings',
        component: PageComponent,
        data: {
            breadcrumb: _('breadcrumb.global-settings'),
            locationId: 'global-setting-detail',
        },
        resolve: {
            detail: () =>
                inject(DataService)
                    .query(GetGlobalSettingsDetailDocument)
                    .mapSingle(data => ({ entity: of(data.globalSettings) })),
        },
        children: pageService.getPageTabRoutes('global-setting-detail'),
    },
];
