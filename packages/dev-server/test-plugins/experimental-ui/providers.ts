import { registerDataTableComponent } from '@vendure/admin-ui/core';
import { registerReactCustomDetailComponent, registerReactDataTableComponent } from '@vendure/admin-ui/react';

import { ProductInfo } from './components/CustomDetailComponent';
import { SlugWithLinkComponent } from './components/slug-with-link.component';
import { SlugWithLink } from './components/SlugWithLink';
import { CmsDataService } from './providers/cms-data.service';

export default [
    CmsDataService,
    registerDataTableComponent({
        component: SlugWithLinkComponent,
        tableId: 'product-list',
        columnId: 'slug',
    }),
    registerReactDataTableComponent({
        component: SlugWithLink,
        tableId: 'collection-list',
        columnId: 'slug',
        props: {
            foo: 'bar',
        },
    }),
    registerReactCustomDetailComponent({
        locationId: 'product-detail',
        component: ProductInfo,
    }),
];
