import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import {
    DataService,
    GetCouponCodeSelectorPromotionListDocument,
    PROMOTION_FRAGMENT,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { concat, Observable, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, skip, startWith, switchMap } from 'rxjs/operators';

export const GET_COUPON_CODE_SELECTOR_PROMOTION_LIST = gql`
    query GetCouponCodeSelectorPromotionList($options: PromotionListOptions) {
        promotions(options: $options) {
            items {
                id
                name
                couponCode
            }
            totalItems
        }
    }
`;

@Component({
    selector: 'vdr-coupon-code-selector',
    templateUrl: './coupon-code-selector.component.html',
    styleUrls: ['./coupon-code-selector.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CouponCodeSelectorComponent implements OnInit {
    @Input() couponCodes: string[];
    @Input() control: UntypedFormControl | undefined;
    @Output() addCouponCode = new EventEmitter<string>();
    @Output() removeCouponCode = new EventEmitter<string>();
    availableCouponCodes$: Observable<Array<{ code: string; promotionName: string }>>;
    couponCodeInput$ = new Subject<string>();
    constructor(private dataService: DataService) {}

    ngOnInit(): void {
        this.availableCouponCodes$ = concat(
            this.couponCodeInput$.pipe(
                debounceTime(200),
                distinctUntilChanged(),
                switchMap(
                    term =>
                        this.dataService.query(GetCouponCodeSelectorPromotionListDocument, {
                            options: {
                                take: 10,
                                skip: 0,
                                filter: {
                                    couponCode: { contains: term },
                                },
                            },
                        }).single$,
                ),
                map(({ promotions }) =>
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    promotions.items.map(p => ({ code: p.couponCode!, promotionName: p.name })),
                ),
                startWith([]),
            ),
        );
        if (!this.control) {
            this.control = new UntypedFormControl(this.couponCodes ?? []);
        }
    }

    remove(code: string) {
        this.removeCouponCode.emit(code);
    }
}
