import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
    BaseListComponent,
    DataService,
    DataTableFilterCollection,
    DataTableSortCollection,
    ItemOf,
    SharedModule,
} from '@vendure/admin-ui/core';
import gql from 'graphql-tag';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import { PRODUCT_REVIEW_FRAGMENT } from '../../common/fragments.graphql';
import {
    GetReviewForProductDocument,
    GetReviewForProductQuery,
    GetReviewForProductQueryVariables,
    GetReviewsHistogramDocument,
    GetReviewsHistogramQuery,
    ProductReviewFilterParameter,
    ProductReviewHistogramItem,
    ProductReviewSortParameter,
} from '../../generated-types';
import { ReviewHistogramComponent } from '../review-histogram/review-histogram.component';
import { StarRatingComponent } from '../star-rating/star-rating.component';

export const GET_REVIEWS_FOR_PRODUCT = gql`
    query GetReviewForProduct($productId: ID!, $options: ProductReviewListOptions) {
        product(id: $productId) {
            id
            reviews(options: $options) {
                items {
                    ...ProductReview
                }
                totalItems
            }
        }
    }
    ${PRODUCT_REVIEW_FRAGMENT}
`;

export const GET_PRODUCT_PREVIEW_AND_HISTOGRAM = gql`
    query GetReviewsHistogram($id: ID!) {
        product(id: $id) {
            id
            name
            featuredAsset {
                id
                preview
            }
            customFields {
                reviewRating
                reviewCount
            }
            reviewsHistogram {
                bin
                frequency
            }
        }
    }
`;

@Component({
    selector: 'product-reviews-list',
    templateUrl: './product-reviews-list.component.html',
    styleUrls: ['./product-reviews-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [SharedModule, StarRatingComponent, ReviewHistogramComponent],
})
export class ProductReviewsListComponent
    extends BaseListComponent<
        GetReviewForProductQuery,
        ItemOf<NonNullable<GetReviewForProductQuery['product']>, 'reviews'>,
        GetReviewForProductQueryVariables
    >
    implements OnInit
{
    histogramBinData$: Observable<ProductReviewHistogramItem[]>;
    product$: Observable<GetReviewsHistogramQuery['product'] | null>;
    private filteredRating: number | null;

    // Here we set up the filters that will be available
    // to use in the data table
    readonly filters = new DataTableFilterCollection<ProductReviewFilterParameter>(this.router)
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
    readonly sorts = new DataTableSortCollection<ProductReviewSortParameter>(this.router)
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

    constructor(private dataService: DataService, protected router: Router, route: ActivatedRoute) {
        super(router, route);
        super.setQueryFn(
            (...args: any) => {
                return this.dataService.query(GetReviewForProductDocument, args);
            },
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            data => data.product!.reviews,
            (skip, take) => {
                return {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    productId: route.snapshot.parent!.paramMap.get('id')!,
                    options: {
                        skip,
                        take,
                        sort: this.sorts.createSortInput(),
                        filter: {
                            authorName: {
                                contains: this.searchTermControl.value ?? undefined,
                            },
                            ...this.filters.createFilterInput(),
                        },
                    },
                };
            },
        );
    }

    ngOnInit() {
        super.ngOnInit();
        const productWithHistogram$ = this.dataService
            .query(GetReviewsHistogramDocument, {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                id: this.route.snapshot.parent!.paramMap.get('id')! || '',
            })
            .single$.pipe(shareReplay(1));
        this.histogramBinData$ = productWithHistogram$.pipe(
            map(data => (data.product ? data.product.reviewsHistogram : [])),
        );
        this.product$ = productWithHistogram$.pipe(map(data => data.product));
        this.refreshListOnChanges(this.filters.valueChanges, this.sorts.valueChanges);
    }

    applyRatingFilters(filteredBin: number) {
        this.filteredRating = filteredBin;
        this.refresh();
    }
}
