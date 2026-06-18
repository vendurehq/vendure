import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    GetPromotionListDocument,
    LogicalOperator,
    PROMOTION_FRAGMENT,
    PromotionListOptions,
    PromotionSortParameter,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const GET_PROMOTION_LIST = gql`
    query GetPromotionList($options: PromotionListOptions) {
        promotions(options: $options) {
            items {
                ...Promotion
            }
            totalItems
        }
    }
    ${PROMOTION_FRAGMENT}
`;

@Component({
    selector: 'vdr-promotion-list',
    templateUrl: './promotion-list.component.html',
    styleUrls: ['./promotion-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PromotionListComponent
    extends TypedBaseListComponent<typeof GetPromotionListDocument, 'promotions'>
    implements OnInit
{
    dataTableListId = 'promotion-list';
    readonly customFields = this.getCustomFieldConfig('Promotion');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilters([
            {
                name: 'startsAt',
                type: { kind: 'dateRange' },
                label: _('marketing.starts-at'),
                filterField: 'startsAt',
            },
            {
                name: 'endsAt',
                type: { kind: 'dateRange' },
                label: _('marketing.ends-at'),
                filterField: 'endsAt',
            },
            {
                name: 'enabled',
                type: { kind: 'boolean' },
                label: _('common.enabled'),
                filterField: 'enabled',
            },
            {
                name: 'name',
                type: { kind: 'text' },
                label: _('common.name'),
                filterField: 'name',
            },
            {
                name: 'couponCode',
                type: { kind: 'text' },
                label: _('marketing.coupon-code'),
                filterField: 'couponCode',
            },
            {
                name: 'desc',
                type: { kind: 'text' },
                label: _('common.description'),
                filterField: 'description',
            },
            {
                name: 'perCustomerUsageLimit',
                type: { kind: 'number' },
                label: _('marketing.per-customer-limit'),
                filterField: 'perCustomerUsageLimit',
            },
            {
                name: 'usageLimit',
                type: { kind: 'number' },
                label: _('marketing.usage-limit'),
                filterField: 'usageLimit',
            },
        ])
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSorts([
            { name: 'createdAt' },
            { name: 'updatedAt' },
            { name: 'startsAt' },
            { name: 'endsAt' },
            { name: 'name' },
            { name: 'couponCode' },
            { name: 'perCustomerUsageLimit' },
            { name: 'usageLimit' },
        ])
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor() {
        super();
        super.configure({
            document: GetPromotionListDocument,
            getItems: data => data.promotions,
            setVariables: (skip, take) => this.createQueryOptions(skip, take, this.searchTermControl.value),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }

    private createQueryOptions(
        skip: number,
        take: number,
        searchTerm: string | null,
    ): { options: PromotionListOptions } {
        const filter = this.filters.createFilterInput();
        const sort = this.sorts.createSortInput();
        let filterOperator = LogicalOperator.AND;
        if (searchTerm) {
            filter.couponCode = { contains: searchTerm };
            filter.name = { contains: searchTerm };
            filterOperator = LogicalOperator.OR;
        }

        return {
            options: {
                skip,
                take,
                filter,
                filterOperator,
                sort,
            },
        };
    }
}
