import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SharedModule, TypedBaseListComponent } from '@vendure/admin-ui/core';
import gql from 'graphql-tag';

import { PRODUCT_REVIEW_FRAGMENT } from '../../common/fragments.graphql';
import { GetAllReviewsDocument } from '../../generated-types';
import { ReviewStateLabelComponent } from '../review-state-label/review-state-label.component';
import { StarRatingComponent } from '../star-rating/star-rating.component';

export const GET_ALL_REVIEWS = gql`
    query GetAllReviews($options: ProductReviewListOptions) {
        productReviews(options: $options) {
            items {
                ...ProductReview
                product {
                    id
                    name
                    featuredAsset {
                        id
                        preview
                    }
                }
            }
            totalItems
        }
    }
    ${PRODUCT_REVIEW_FRAGMENT}
`;

@Component({
    selector: 'all-product-reviews-list',
    templateUrl: './all-product-reviews-list.component.html',
    styleUrls: ['./all-product-reviews-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [SharedModule, StarRatingComponent, ReviewStateLabelComponent],
})
export class AllProductReviewsListComponent extends TypedBaseListComponent<
    typeof GetAllReviewsDocument,
    'productReviews'
> {
    filteredState: string | null = 'new';

    // Here we set up the filters that will be available
    // to use in the data table
    readonly filters = this.createFilterCollection()
        .addDateFilters()
        .addFilter({
            name: 'summary',
            type: { kind: 'text' },
            label: 'Summary',
            filterField: 'summary',
        })
        .addFilter({
            name: 'rating',
            type: { kind: 'number' },
            label: 'Rating',
            filterField: 'rating',
        })
        .addFilter({
            name: 'state',
            type: {
                kind: 'select',
                options: [
                    { value: 'new', label: 'New' },
                    { value: 'approved', label: 'Approved' },
                    { value: 'rejected', label: 'Rejected' },
                ],
            },
            label: 'State',
            filterField: 'state',
        })
        .addFilter({
            name: 'authorName',
            type: { kind: 'text' },
            label: 'Author',
            filterField: 'authorName',
        })
        .addFilter({
            name: 'authorLocation',
            type: { kind: 'text' },
            label: 'Location',
            filterField: 'authorLocation',
        })
        .addFilter({
            name: 'upvotes',
            type: { kind: 'number' },
            label: 'Upvotes',
            filterField: 'upvotes',
        })
        .addFilter({
            name: 'downvotes',
            type: { kind: 'number' },
            label: 'Downvotes',
            filterField: 'downvotes',
        })
        .connectToRoute(this.route);

    // Here we set up the sorting options that will be available
    // to use in the data table
    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'summary' })
        .addSort({ name: 'state' })
        .addSort({ name: 'upvotes' })
        .addSort({ name: 'downvotes' })
        .addSort({ name: 'rating' })
        .addSort({ name: 'authorName' })
        .addSort({ name: 'authorLocation' })
        .connectToRoute(this.route);

    constructor() {
        super();
        super.configure({
            document: GetAllReviewsDocument,
            getItems: data => data.productReviews,
            setVariables: (skip, take) => ({
                options: {
                    skip,
                    take,
                    filter: {
                        authorName: {
                            contains: this.searchTermControl.value ?? undefined,
                        },
                        ...this.filters.createFilterInput(),
                    },
                    sort: this.sorts.createSortInput(),
                },
            }),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }
}
