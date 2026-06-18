import { registerRouteComponent } from '@vendure/admin-ui/core';
import { ProductBundleListComponent } from './components/product-bundle-list/product-bundle-list.component';

export default [
    registerRouteComponent({
        path: '',
        component: ProductBundleListComponent,
        breadcrumb: 'Product bundles',
    }),
];
