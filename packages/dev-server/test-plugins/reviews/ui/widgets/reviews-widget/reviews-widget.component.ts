import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { DataService, ItemOf, SharedModule } from '@vendure/admin-ui/core';
import gql from 'graphql-tag';
import { Observable } from 'rxjs';

import { ReviewStateLabelComponent } from '../../components/review-state-label/review-state-label.component';
import { StarRatingComponent } from '../../components/star-rating/star-rating.component';
import { GetReviewsForWidgetDocument, GetReviewsForWidgetQuery } from '../../generated-types';

const GET_REVIEWS_FOR_WIDGET = gql`
    query GetReviewsForWidget($options: ProductReviewListOptions) {
        productReviews(options: $options) {
            items {
                id
                authorName
                summary
                rating
                state
                createdAt
                product {
                    id
                    name
                }
            }
            totalItems
        }
    }
`;

@Component({
    selector: 'vdr-reviews-widget',
    templateUrl: './reviews-widget.component.html',
    styleUrls: ['./reviews-widget.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [SharedModule, StarRatingComponent, ReviewStateLabelComponent],
})
export default class ReviewsWidgetComponent implements OnInit {
    pendingReviews$: Observable<Array<ItemOf<GetReviewsForWidgetQuery, 'productReviews'>>>;
    constructor(private dataService: DataService) {}

    ngOnInit() {
        this.pendingReviews$ = this.dataService
            .query(GetReviewsForWidgetDocument, {
                options: {
                    filter: {
                        state: {
                            eq: 'new',
                        },
                    },
                    take: 10,
                },
            })
            .mapStream(data => data.productReviews.items);
    }
}
