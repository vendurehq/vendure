import { parse } from 'graphql';

import { addBulkAction, addListQueryDocument } from '../../data-table/data-table-extensions.js';
import { addDisplayComponent } from '../display-component-extensions.js';
import { DashboardDataTableExtensionDefinition } from '../types/index.js';

export function registerDataTableExtensions(dataTables?: DashboardDataTableExtensionDefinition[]) {
    if (dataTables) {
        for (const dataTable of dataTables) {
            if (dataTable.bulkActions?.length) {
                for (const action of dataTable.bulkActions) {
                    addBulkAction(dataTable.pageId, dataTable.blockId, action);
                }
            }
            if (dataTable.extendListDocument) {
                const document =
                    typeof dataTable.extendListDocument === 'function'
                        ? dataTable.extendListDocument()
                        : dataTable.extendListDocument;

                addListQueryDocument(
                    dataTable.pageId,
                    dataTable.blockId,
                    typeof document === 'string' ? parse(document) : document,
                );
            }
            if (dataTable.displayComponents?.length) {
                for (const displayComponent of dataTable.displayComponents) {
                    const blockId = dataTable.blockId ?? 'list-table';
                    const { pageId } = dataTable;
                    const { column, component } = displayComponent;
                    addDisplayComponent({ pageId, blockId, field: column, component });
                }
            }
        }
    }
}
