import { graphql } from '@/graphql/graphql';
import { DashboardRouteDefinition, DetailPage, detailPageRouteLoader } from '@vendure/dashboard';

const reviewDetailDocument = graphql(`
    query GetReviewDetail($id: ID!) {
        productReview(id: $id) {
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
            translations {
                id
                languageCode
                text
            }
        }
    }
`);

const updateReviewDocument = graphql(`
    mutation UpdateReview($input: UpdateProductReviewInput!) {
        updateProductReview(input: $input) {
            id
        }
    }
`);

export const reviewDetail: DashboardRouteDefinition = {
    path: '/reviews/$id',
    loader: detailPageRouteLoader({
        queryDocument: reviewDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/reviews', label: 'Reviews' },
            isNew ? 'New review' : entity?.summary,
        ],
    }),
    component: route => {
        return (
            <DetailPage
                pageId="review-detail"
                queryDocument={reviewDetailDocument}
                updateDocument={updateReviewDocument}
                route={route}
                title={review => review.summary}
                setValuesForUpdate={review => {
                    return {
                        id: review.id,
                        summary: review.summary,
                        body: review.body,
                        response: review.response,
                        state: review.state,
                        customFields: review.customFields,
                        translations: review.translations,
                    };
                }}
            />
        );
    },
};
