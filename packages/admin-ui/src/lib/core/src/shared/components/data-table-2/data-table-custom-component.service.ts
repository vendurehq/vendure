import { Injectable, Provider, Type } from '@angular/core';
import { PageLocationId } from '../../../common/component-registry-types';

export type DataTableLocationId =
    | {
          [location in PageLocationId]: location extends `${string}-list` ? location : never;
      }[PageLocationId]
    | 'collection-contents'
    | 'edit-options-list'
    | 'manage-product-variant-list'
    | 'customer-order-list'
    | 'product-detail-variants-list'
    | string;

export type DataTableColumnId =
    | 'id'
    | 'created-at'
    | 'updated-at'
    | 'name'
    | 'code'
    | 'description'
    | 'slug'
    | 'enabled'
    | 'sku'
    | 'price'
    | 'price-with-tax'
    | 'status'
    | 'state'
    | 'image'
    | 'quantity'
    | 'total'
    | 'stock-on-hand'
    | string;

/**
 * @description
 * Components which are to be used to render custom cells in a data table should implement this interface.
 *
 * The `rowItem` property is the data object for the row, e.g. the `Product` object if used
 * in the `product-list` table.
 *
 * @docsCategory custom-table-components
 */
export interface CustomColumnComponent {
    rowItem: any;
}

/**
 * @description
 * Configures a {@link CustomDetailComponent} to be placed in the given location.
 *
 * @docsCategory custom-table-components
 */
export interface DataTableComponentConfig {
    /**
     * @description
     * The location in the UI where the custom component should be placed.
     */
    tableId: DataTableLocationId;
    /**
     * @description
     * The column in the table where the custom component should be placed.
     */
    columnId: DataTableColumnId;
    /**
     * @description
     * The component to render in the table cell. This component should implement the
     * {@link CustomColumnComponent} interface.
     */
    component: Type<CustomColumnComponent>;
    providers?: Provider[];
}

type CompoundId = `${DataTableLocationId}.${DataTableColumnId}`;

@Injectable({
    providedIn: 'root',
})
export class DataTableCustomComponentService {
    private configMap = new Map<CompoundId, DataTableComponentConfig>();

    registerCustomComponent(config: DataTableComponentConfig) {
        const id = this.compoundId(config.tableId, config.columnId);
        this.configMap.set(id, config);
    }

    getCustomComponentsFor(
        tableId: DataTableLocationId,
        columnId: DataTableColumnId,
    ): DataTableComponentConfig | undefined {
        return this.configMap.get(this.compoundId(tableId, columnId));
    }

    private compoundId(tableId: DataTableLocationId, columnId: DataTableColumnId): CompoundId {
        return `${tableId}.${columnId}`;
    }
}
