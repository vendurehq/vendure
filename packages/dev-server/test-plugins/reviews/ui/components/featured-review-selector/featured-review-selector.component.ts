import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { CustomFieldControl, DataService, SharedModule } from '@vendure/admin-ui/core';
import { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { GetReviewForProductDocument, ProductReviewFragment } from '../../generated-types';

@Component({
    selector: 'kb-relation-review-input',
    template: `
        <div *ngIf="formControl.value as review">
            <vdr-chip>{{ review.rating }} / 5</vdr-chip>
            {{ review.summary }}
            <a [routerLink]="['/extensions', 'product-reviews', review.id]">
                <clr-icon shape="link"></clr-icon>
            </a>
        </div>
        <select class="mt-1" [formControl]="formControl">
            <option [ngValue]="null">Select a review...</option>
            <option *ngFor="let item of reviews$ | async" [ngValue]="item">
                <b>{{ item.summary }}</b>
                {{ item.rating }} / 5
            </option>
        </select>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [SharedModule],
})
export class RelationReviewInputComponent implements OnInit, CustomFieldControl {
    @Input() readonly: boolean;
    @Input() formControl: FormControl;
    @Input() config: any;

    reviews$: Observable<ProductReviewFragment[]>;

    constructor(private dataService: DataService, private route: ActivatedRoute) {}

    ngOnInit() {
        this.reviews$ = this.route.data.pipe(
            switchMap(data => data.detail.entity),
            switchMap((product: any) => {
                return this.dataService
                    .query(GetReviewForProductDocument, {
                        productId: product.id,
                    })
                    .mapSingle(({ product }) => product?.reviews.items ?? []);
            }),
        );
    }
}
