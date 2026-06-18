import { Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    FACET_WITH_VALUE_LIST_FRAGMENT,
    GetFacetListDocument,
    GetFacetListQuery,
    ItemOf,
    LanguageCode,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const FACET_LIST_QUERY = gql`
    query GetFacetList($options: FacetListOptions, $facetValueListOptions: FacetValueListOptions) {
        facets(options: $options) {
            items {
                ...FacetWithValueList
            }
            totalItems
        }
    }
    ${FACET_WITH_VALUE_LIST_FRAGMENT}
`;

@Component({
    selector: 'vdr-facet-list',
    templateUrl: './facet-list.component.html',
    styleUrls: ['./facet-list.component.scss'],
    standalone: false
})
export class FacetListComponent
    extends TypedBaseListComponent<typeof GetFacetListDocument, 'facets'>
    implements OnInit
{
    readonly initialLimit = 3;
    displayLimit: { [id: string]: number } = {};

    dataTableListId = 'facet-list';
    readonly customFields = this.getCustomFieldConfig('Facet');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'visibility',
            type: { kind: 'boolean' },
            label: _('common.visibility'),
            toFilterInput: value => ({
                isPrivate: { eq: !value },
            }),
        })
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSort({ name: 'id' })
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'name' })
        .addSort({ name: 'code' })
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor(protected dataService: DataService) {
        super();
        super.configure({
            document: GetFacetListDocument,
            getItems: data => data.facets,
            setVariables: (skip, take) => ({
                options: {
                    skip,
                    take,
                    filter: {
                        name: {
                            contains: this.searchTermControl.value,
                        },
                        ...this.filters.createFilterInput(),
                    },
                    sort: this.sorts.createSortInput(),
                },
                facetValueListOptions: {
                    take: 100,
                },
            }),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }

    toggleDisplayLimit(facet: ItemOf<GetFacetListQuery, 'facets'>) {
        if (this.displayLimit[facet.id] === facet.valueList.items.length) {
            this.displayLimit[facet.id] = this.initialLimit;
        } else {
            this.displayLimit[facet.id] = facet.valueList.items.length;
        }
    }

    setLanguage(code: LanguageCode) {
        this.dataService.client.setContentLanguage(code).subscribe();
    }
}
