import {
    FieldInfo,
    getListQueryFields,
} from '@/vdb/framework/document-introspection/get-document-structure.js';
import { DocumentNode } from 'graphql';
import { useMemo } from 'react';

/**
 * Returns a stable array of FieldInfo objects representing the fields of the list query.
 */
export function useListQueryFields(documentNode: DocumentNode): FieldInfo[] {
    return useMemo(() => getListQueryFields(documentNode), [documentNode]);
}
