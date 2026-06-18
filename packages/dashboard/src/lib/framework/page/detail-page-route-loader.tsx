import { NEW_ENTITY_PATH } from '@/vdb/constants.js';

import { PageBreadcrumb } from '@/vdb/components/layout/generated-breadcrumbs.js';
import { extendDetailFormQuery } from '@/vdb/framework/document-extension/extend-detail-form-query.js';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { FileBaseRouteOptions, ParsedLocation } from '@tanstack/react-router';
import { addCustomFields } from '../document-introspection/add-custom-fields.js';
import { getQueryName, getQueryTypeFieldInfo } from '../document-introspection/get-document-structure.js';
import { DetailEntity } from './page-types.js';
import { getDetailQueryOptions } from './use-detail-page.js';

export interface DetailPageRouteLoaderConfig<T extends TypedDocumentNode<any, any>> {
    /**
     * @description
     * The pageId is used to ensure any detail form extensions (such as extensions to
     * the detail query document) get correctly applied at the route loader level.
     */
    pageId?: string;
    queryDocument: T | (() => T);
    breadcrumb: (
        isNew: boolean,
        entity: DetailEntity<T>,
        location: ParsedLocation,
    ) => Array<PageBreadcrumb | undefined>;
}

export function detailPageRouteLoader<T extends TypedDocumentNode<any, any>>({
    pageId,
    queryDocument,
    breadcrumb,
}: DetailPageRouteLoaderConfig<T>) {
    const loader: FileBaseRouteOptions<any, any, any>['loader'] = async ({
        context,
        params,
        location,
    }: {
        context: any;
        params: any;
        location: ParsedLocation;
    }) => {
        const resolvedQueryDocument = typeof queryDocument === 'function' ? queryDocument() : queryDocument;

        if (!params.id) {
            throw new Error('ID param is required');
        }
        const isNew = params.id === NEW_ENTITY_PATH;
        const { extendedQuery: extendedQueryDocument } = extendDetailFormQuery(
            addCustomFields(resolvedQueryDocument),
            pageId,
        );
        const result = isNew
            ? null
            : await context.queryClient.ensureQueryData(
                  getDetailQueryOptions(extendedQueryDocument, { id: params.id }),
                  { id: params.id },
              );

        const entityField = getQueryName(resolvedQueryDocument);
        const entityName = getQueryTypeFieldInfo(resolvedQueryDocument)?.type;

        if (!isNew && !result[entityField]) {
            throw new Error(`${entityName} with the ID ${params.id} was not found`);
        }
        return {
            breadcrumb: breadcrumb(isNew, result?.[entityField], location),
        };
    };
    return loader;
}
