import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import {
    DataService,
    Dialog,
    FacetValueFragment,
    GetProductsWithFacetValuesByIdsQuery,
    GetProductsWithFacetValuesByIdsQueryVariables,
    GetVariantsWithFacetValuesByIdsQuery,
    UpdateProductsBulkMutation,
    UpdateProductsBulkMutationVariables,
    UpdateVariantsBulkMutation,
    UpdateVariantsBulkMutationVariables,
} from '@vendure/admin-ui/core';
import { unique } from '@vendure/common/lib/unique';
import { Observable, Subscription } from 'rxjs';

import {
    GET_PRODUCTS_WITH_FACET_VALUES_BY_IDS,
    GET_VARIANTS_WITH_FACET_VALUES_BY_IDS,
    UPDATE_PRODUCTS_BULK,
    UPDATE_VARIANTS_BULK,
} from './bulk-add-facet-values-dialog.graphql';

interface ProductOrVariant {
    id: string;
    name: string;
    sku?: string;
    facetValues: Array<{
        id: string;
        name: string;
        code: string;
        facet: Array<{
            id: string;
            name: string;
            code: string;
        }>;
    }>;
}

@Component({
    selector: 'vdr-bulk-add-facet-values-dialog',
    templateUrl: './bulk-add-facet-values-dialog.component.html',
    styleUrls: ['./bulk-add-facet-values-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class BulkAddFacetValuesDialogComponent implements OnInit, OnDestroy, Dialog<FacetValueFragment[]> {
    resolveWith: (result?: FacetValueFragment[]) => void;
    /* provided by call to ModalService */
    mode: 'product' | 'variant' = 'product';
    ids?: string[];
    state: 'loading' | 'ready' | 'saving' = 'loading';

    selectedValues: FacetValueFragment[] = [];
    items: ProductOrVariant[] = [];
    facetValuesRemoved = false;
    private subscription: Subscription;
    constructor(
        private dataService: DataService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        const fetchData$: Observable<any> =
            this.mode === 'product'
                ? this.dataService
                      .query<
                          GetProductsWithFacetValuesByIdsQuery,
                          GetProductsWithFacetValuesByIdsQueryVariables
                      >(GET_PRODUCTS_WITH_FACET_VALUES_BY_IDS, {
                          ids: this.ids ?? [],
                      })
                      .mapSingle(({ products }) =>
                          products.items.map(p => ({ ...p, facetValues: [...p.facetValues] })),
                      )
                : this.dataService
                      .query<
                          GetVariantsWithFacetValuesByIdsQuery,
                          GetProductsWithFacetValuesByIdsQueryVariables
                      >(GET_VARIANTS_WITH_FACET_VALUES_BY_IDS, {
                          ids: this.ids ?? [],
                      })
                      .mapSingle(({ productVariants }) =>
                          productVariants.items.map(p => ({ ...p, facetValues: [...p.facetValues] })),
                      );
        this.subscription = fetchData$.subscribe({
            next: items => {
                this.items = items;
                this.state = 'ready';
                this.changeDetectorRef.markForCheck();
            },
        });
    }

    ngOnDestroy() {
        this.subscription?.unsubscribe();
    }

    cancel() {
        this.resolveWith();
    }

    removeFacetValue(item: ProductOrVariant, facetValueId: string) {
        item.facetValues = item.facetValues.filter(fv => fv.id !== facetValueId);
        this.facetValuesRemoved = true;
    }

    addFacetValues() {
        const selectedFacetValueIds = this.selectedValues.map(sv => sv.id);
        this.state = 'saving';
        const save$: Observable<any> =
            this.mode === 'product'
                ? this.dataService.mutate<UpdateProductsBulkMutation, UpdateProductsBulkMutationVariables>(
                      UPDATE_PRODUCTS_BULK,
                      {
                          input: this.items?.map(product => ({
                              id: product.id,
                              facetValueIds: unique([
                                  ...product.facetValues.map(fv => fv.id),
                                  ...selectedFacetValueIds,
                              ]),
                          })),
                      },
                  )
                : this.dataService.mutate<UpdateVariantsBulkMutation, UpdateVariantsBulkMutationVariables>(
                      UPDATE_VARIANTS_BULK,
                      {
                          input: this.items?.map(product => ({
                              id: product.id,
                              facetValueIds: unique([
                                  ...product.facetValues.map(fv => fv.id),
                                  ...selectedFacetValueIds,
                              ]),
                          })),
                      },
                  );
        return save$.subscribe(result => {
            this.resolveWith(this.selectedValues);
        });
    }
}
