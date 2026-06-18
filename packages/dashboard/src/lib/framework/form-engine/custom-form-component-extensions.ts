import { DocumentNode } from 'graphql';

import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('detailQueryDocumentRegistry', new Map<string, DocumentNode[]>());

export function getDetailQueryDocuments(pageId: string): DocumentNode[] {
    return globalRegistry.get('detailQueryDocumentRegistry').get(pageId) || [];
}

export function addDetailQueryDocument(pageId: string, document: DocumentNode) {
    const listQueryDocumentRegistry = globalRegistry.get('detailQueryDocumentRegistry');
    const existingDocuments = listQueryDocumentRegistry.get(pageId) || [];
    listQueryDocumentRegistry.set(pageId, [...existingDocuments, document]);
}
