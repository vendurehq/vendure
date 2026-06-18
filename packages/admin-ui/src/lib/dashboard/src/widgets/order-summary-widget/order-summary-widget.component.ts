import { ChangeDetectionStrategy, Component, NgModule, OnInit } from '@angular/core';
import { CoreModule, DataService, GetOrderSummaryDocument } from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import dayjs from 'dayjs';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, switchMap } from 'rxjs/operators';

export type Timeframe = 'day' | 'week' | 'month';

export const GET_ORDER_SUMMARY = gql`
    query GetOrderSummary($start: DateTime!, $end: DateTime!) {
        orders(options: { filter: { orderPlacedAt: { between: { start: $start, end: $end } } } }) {
            totalItems
            items {
                id
                totalWithTax
                currencyCode
            }
        }
    }
`;

@Component({
    selector: 'vdr-order-summary-widget',
    templateUrl: './order-summary-widget.component.html',
    styleUrls: ['./order-summary-widget.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderSummaryWidgetComponent implements OnInit {
    today = new Date();
    yesterday = new Date(new Date().setDate(this.today.getDate() - 1));
    totalOrderCount$: Observable<number>;
    totalOrderValue$: Observable<number>;
    currencyCode$: Observable<string | undefined>;
    selection$ = new BehaviorSubject<{ timeframe: Timeframe; date?: Date }>({
        timeframe: 'day',
        date: this.today,
    });
    dateRange$: Observable<{ start: Date; end: Date }>;

    constructor(private dataService: DataService) {}

    ngOnInit(): void {
        this.dateRange$ = this.selection$.pipe(
            distinctUntilChanged(),
            map(selection => ({
                start: dayjs(selection.date).startOf(selection.timeframe).toDate(),
                end: dayjs(selection.date).endOf(selection.timeframe).toDate(),
            })),
            shareReplay(1),
        );
        const orderSummary$ = this.dateRange$.pipe(
            switchMap(({ start, end }) =>
                this.dataService
                    .query(GetOrderSummaryDocument, { start: start.toISOString(), end: end.toISOString() })
                    .refetchOnChannelChange()
                    .mapStream(data => data.orders),
            ),
            shareReplay(1),
        );
        this.totalOrderCount$ = orderSummary$.pipe(map(res => res.totalItems));
        this.totalOrderValue$ = orderSummary$.pipe(
            map(res => res.items.reduce((total, order) => total + order.totalWithTax, 0)),
        );
        this.currencyCode$ = this.dataService.settings
            .getActiveChannel()
            .refetchOnChannelChange()
            .mapStream(data => data.activeChannel.defaultCurrencyCode || undefined);
    }
}

@NgModule({
    imports: [CoreModule],
    declarations: [OrderSummaryWidgetComponent],
})
export class OrderSummaryWidgetModule {}
