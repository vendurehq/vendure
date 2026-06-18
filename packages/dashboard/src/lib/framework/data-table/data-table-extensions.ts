import { BulkAction } from '@/vdb/framework/extension-api/types/index.js';
import { DocumentNode } from 'graphql';

import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('bulkActionsRegistry', new Map<string, BulkAction[]>());
globalRegistry.register('listQueryDocumentRegistry', new Map<string, DocumentNode[]>());

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

function createKey(pageId: string, blockId: string | undefined): string {
    return `${pageId}__${blockId ?? 'list-table'}`;
}
