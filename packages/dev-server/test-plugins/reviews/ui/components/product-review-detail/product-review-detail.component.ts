import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import {
    DataService,
    NotificationService,
    SharedModule,
    TypedBaseDetailComponent,
} from '@vendure/admin-ui/core';
import gql from 'graphql-tag';
import { Observable, of } from 'rxjs';
import { filter, map, mapTo, switchMap } from 'rxjs/operators';

import { PRODUCT_REVIEW_FRAGMENT } from '../../common/fragments.graphql';
import { ReviewState } from '../../common/ui-types';
import {
    ApproveReviewDocument,
    GetReviewDetailDocument,
    ProductReviewFragment,
    RejectReviewDocument,
    UpdateProductReviewInput,
    UpdateReviewDocument,
} from '../../generated-types';
import { ReviewStateLabelComponent } from '../review-state-label/review-state-label.component';
import { StarRatingComponent } from '../star-rating/star-rating.component';

export const GET_REVIEW_DETAIL = gql`
    query GetReviewDetail($id: ID!) {
        productReview(id: $id) {
            ...ProductReview
            product {
                id
                name
                featuredAsset {
                    id
                    preview
                }
            }
            productVariant {
                id
                name
                featuredAsset {
                    id
                    preview
                }
            }
        }
    }
    ${PRODUCT_REVIEW_FRAGMENT}
`;

@Component({
    selector: 'product-review-detail',
    templateUrl: './product-review-detail.component.html',
    styleUrls: ['./product-review-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.Default,
    standalone: true,
    imports: [SharedModule, StarRatingComponent, ReviewStateLabelComponent],
})
export class ProductReviewDetailComponent
    extends TypedBaseDetailComponent<typeof GetReviewDetailDocument, 'productReview'>
    implements OnInit, OnDestroy
{
    detailForm = this.formBuilder.group({
        summary: ['', Validators.required],
        body: '',
        rating: [0, Validators.required],
        authorName: ['', Validators.required],
        authorLocation: '',
        state: '',
        response: '',
    });
    reviewState$: Observable<ReviewState>;

    constructor(
        private formBuilder: FormBuilder,
        protected dataService: DataService,
        private changeDetector: ChangeDetectorRef,
        private notificationService: NotificationService,
    ) {
        super();
    }

    ngOnInit(): void {
        this.init();
        this.reviewState$ = this.entity$.pipe(map(review => review.state as ReviewState));
    }

    ngOnDestroy(): void {
        this.destroy();
    }

    approve() {
        this.saveChanges()
            .pipe(switchMap(() => this.dataService.mutate(ApproveReviewDocument, { id: this.id })))
            .subscribe(
                () => {
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                    this.notificationService.success('Review was approved');
                },
                () => {
                    this.notificationService.error('An error occurred when attempting to approve the review');
                },
            );
    }

    reject() {
        this.saveChanges()
            .pipe(switchMap(() => this.dataService.mutate(RejectReviewDocument, { id: this.id })))
            .subscribe(
                () => {
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                    this.notificationService.success('Review was rejected');
                },
                () => {
                    this.notificationService.error('An error occurred when attempting to reject the review');
                },
            );
    }

    save() {
        this.saveChanges()
            .pipe(filter(result => !!result))
            .subscribe(
                () => {
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                    this.notificationService.success('common.notify-update-success', {
                        entity: 'ProductReview',
                    });
                },
                () => {
                    this.notificationService.error('common.notify-update-error', {
                        entity: 'ProductReview',
                    });
                },
            );
    }

    private saveChanges(): Observable<boolean> {
        if (this.detailForm.dirty) {
            const { summary, body, response } = this.detailForm.value;
            const input: UpdateProductReviewInput = {
                id: this.id,
                summary: summary ?? undefined,
                body: body ?? undefined,
                response: response ?? undefined,
            };
            return this.dataService.mutate(UpdateReviewDocument, { input }).pipe(mapTo(true));
        } else {
            return of(false);
        }
    }

    protected setFormValues(entity: ProductReviewFragment): void {
        this.detailForm.patchValue({
            summary: entity.summary,
            body: entity.body,
            rating: entity.rating,
            authorName: entity.authorName,
            authorLocation: entity.authorLocation,
            state: entity.state,
            response: entity.response,
        });
    }
}
