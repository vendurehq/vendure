import { registerReactRouteComponent } from '@vendure/admin-ui/react';

import { Greeter } from './components/Greeter';
import { ProductList } from './components/ProductList';

export default [
    registerReactRouteComponent({
        component: Greeter,
        path: ':name',
        title: 'Greeter Page',
        breadcrumb: 'Greeter',
        props: {
            name: 'World',
        },
    }),
    registerReactRouteComponent({
        component: ProductList,
        path: 'products',
        title: 'Products',
        breadcrumb: 'Products',
    }),
];
