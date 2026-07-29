import {
    BulkAction,
    DashboardDataTableViewOptionDefaults,
} from '@/vdb/framework/extension-api/types/index.js';
import { DocumentNode } from 'graphql';

import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('bulkActionsRegistry', new Map<string, BulkAction[]>());
globalRegistry.register('listQueryDocumentRegistry', new Map<string, DocumentNode[]>());
globalRegistry.register(
    'viewOptionDefaultsRegistry',
    new Map<string, DashboardDataTableViewOptionDefaults>(),
);

export function getBulkActions(pageId: string, blockId = 'list-table'): BulkAction[] {
    const key = createKey(pageId, blockId);
    return globalRegistry.get('bulkActionsRegistry').get(key) || [];
}

export function addBulkAction(pageId: string, blockId: string | undefined, action: BulkAction) {
    const bulkActionsRegistry = globalRegistry.get('bulkActionsRegistry');
    const key = createKey(pageId, blockId);
    const existingActions = bulkActionsRegistry.get(key) || [];
    bulkActionsRegistry.set(key, [...existingActions, action]);
}

export function getListQueryDocuments(pageId: string, blockId = 'list-table'): DocumentNode[] {
    const key = createKey(pageId, blockId);
    return globalRegistry.get('listQueryDocumentRegistry').get(key) || [];
}

export function addListQueryDocument(pageId: string, blockId: string | undefined, document: DocumentNode) {
    const listQueryDocumentRegistry = globalRegistry.get('listQueryDocumentRegistry');
    const key = createKey(pageId, blockId);
    const existingDocuments = listQueryDocumentRegistry.get(key) || [];
    listQueryDocumentRegistry.set(key, [...existingDocuments, document]);
}

export function getViewOptionDefaults(
    pageId: string,
    blockId = 'list-table',
): DashboardDataTableViewOptionDefaults {
    const key = createKey(pageId, blockId);
    return globalRegistry.get('viewOptionDefaultsRegistry').get(key) || {};
}

/**
 * Registers default view options for a data table identified by `pageId`/`blockId`.
 *
 * When called multiple times for the same target (e.g. by several plugins),
 * the registered defaults are merged as follows:
 *
 * - `columnVisibility`: shallow-merged. For a given column, the value supplied
 *   by the **last** plugin to register wins.
 * - `columnOrder`: appended in registration order and de-duplicated, so a
 *   column keeps the position given by the **first** plugin to register it.
 */
export function addViewOptionDefaults(
    pageId: string,
    blockId: string | undefined,
    viewOptionDefaults: DashboardDataTableViewOptionDefaults,
) {
    const defaultsRegistry = globalRegistry.get('viewOptionDefaultsRegistry');
    const key = createKey(pageId, blockId);
    const existingDefaults = defaultsRegistry.get(key) || {};
    defaultsRegistry.set(key, {
        columnOrder: [
            ...new Set([...(existingDefaults?.columnOrder ?? []), ...(viewOptionDefaults.columnOrder ?? [])]),
        ],
        columnVisibility: {
            ...(existingDefaults?.columnVisibility ?? {}),
            ...(viewOptionDefaults.columnVisibility ?? {}),
        },
    });
}

function createKey(pageId: string, blockId: string | undefined): string {
    return `${pageId}__${blockId ?? 'list-table'}`;
}
