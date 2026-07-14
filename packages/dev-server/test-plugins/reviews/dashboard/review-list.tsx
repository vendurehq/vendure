import { graphql } from '@/graphql/graphql';
import { Trans } from '@lingui/react/macro';
import {
    ActionBarItem,
    Button,
    DashboardRouteDefinition,
    DetailPageButton,
    ListPage,
} from '@vendure/dashboard';

const getReviewList = graphql(`
    query GetProductReviews($options: ProductReviewListOptions) {
        productReviews(options: $options) {
            items {
                id
                createdAt
                updatedAt
                product {
                    id
                    name
                }
                productVariant {
                    id
                    name
                    sku
                }
                summary
                body
                rating
                authorName
                authorLocation
                upvotes
                downvotes
                state
                response
                responseCreatedAt
            }
        }
    }
`);

export const reviewList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'catalog',
        id: 'reviews',
        url: '/reviews',
        title: 'Product Reviews',
        requiresPermission: ['ReadCatalog'],
    },
    path: '/reviews',
    loader: () => ({
        breadcrumb: 'Reviews',
    }),
    component: route => (
        <ListPage
            pageId="review-list"
            title={<Trans>Product Reviews</Trans>}
            listQuery={getReviewList}
            route={route}
            defaultVisibility={{
                productVariant: false,
                product: false,
                summary: false,
                rating: false,
                authorName: false,
                reviewerName: false,
                responseCreatedAt: false,
                response: false,
                upvotes: false,
                downvotes: false,
            }}
            customizeColumns={{
                id: {
                    header: 'ID',
                    cell: ({ row }) => {
                        return <DetailPageButton id={row.original.id} label={row.original.id} />;
                    },
                },
                product: {
                    header: 'Product',
                    cell: ({ row }) => {
                        return <DetailPageButton id={row.original.id} label={row.original.product.name} />;
                    },
                },
                reviewerName: {
                    header: 'Reviewer Name',
                    cell: ({ row }) => {
                        return <div className="text-red-500">{row.original.customFields?.reviewerName}</div>;
                    },
                },
            }}
        >
            <ActionBarItem itemId="my-custom-button">
                <Button>My Button</Button>
            </ActionBarItem>
        </ListPage>
    ),
};
