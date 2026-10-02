import { graphql } from '@/graphql/graphql';
import { defineDashboardExtension, ListPage } from '@vendure/dashboard';

const productListDocument = graphql(`
    query DefaultFiltersTestProductList($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                name
                slug
            }
            totalItems
        }
    }
`);

// #5294 — a list page whose default column filters apply until the user configures their own.
defineDashboardExtension({
    routes: [
        {
            path: '/default-filters-test',
            component: route => (
                <ListPage
                    pageId="default-filters-test"
                    title="Default filters test"
                    listQuery={productListDocument}
                    route={route}
                    defaultColumnFilters={[{ id: 'name', value: { contains: 'Camera' } }]}
                />
            ),
        },
    ],
});
