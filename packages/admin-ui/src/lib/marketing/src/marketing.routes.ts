import { Route } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { detailBreadcrumb, PageComponent, PageService, PromotionFragment } from '@vendure/admin-ui/core';

export const createRoutes = (pageService: PageService): Route[] => [
    {
        path: 'promotions',
        component: PageComponent,
        data: {
            locationId: 'promotion-list',
            breadcrumb: _('breadcrumb.promotions'),
        },
        children: pageService.getPageTabRoutes('promotion-list'),
    },
    {
        path: 'promotions/:id',
        component: PageComponent,
        data: {
            locationId: 'promotion-detail',
            breadcrumb: { label: _('breadcrumb.promotions'), link: ['../', 'promotions'] },
        },
        children: pageService.getPageTabRoutes('promotion-detail'),
    },
];

export function promotionBreadcrumb(data: any, params: any) {
    return detailBreadcrumb<PromotionFragment>({
        entity: data.entity,
        id: params.id,
        breadcrumbKey: 'breadcrumb.promotions',
        getName: promotion => promotion.name,
        route: 'promotions',
    });
}
