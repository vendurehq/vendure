import { addNavMenuItem } from '@vendure/admin-ui/core';

export default [
    addNavMenuItem(
        {
            id: 'product-bundles',
            label: 'Product Bundles',
            routerLink: ['/extensions/product-bundles'],
            icon: '',
        },
        'catalog',
    ),
];
