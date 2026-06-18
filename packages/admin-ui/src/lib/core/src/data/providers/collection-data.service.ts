import { pick } from '@vendure/common/lib/pick';
import { from } from 'rxjs';
import { bufferCount, concatMap } from 'rxjs/operators';

import * as Codegen from '../../common/generated-types';
import {
    ASSIGN_COLLECTIONS_TO_CHANNEL,
    CREATE_COLLECTION,
    DELETE_COLLECTION,
    DELETE_COLLECTIONS,
    GET_COLLECTION_CONTENTS,
    GET_COLLECTION_FILTERS,
    GET_COLLECTION_LIST,
    MOVE_COLLECTION,
    PREVIEW_COLLECTION_CONTENTS,
    REMOVE_COLLECTIONS_FROM_CHANNEL,
    UPDATE_COLLECTION,
} from '../definitions/collection-definitions';

import { BaseDataService, ExtendedQueryOptions } from './base-data.service';

export class CollectionDataService {
    constructor(private baseDataService: BaseDataService) {}

    getCollectionFilters() {
        return this.baseDataService.query<Codegen.GetCollectionFiltersQuery>(GET_COLLECTION_FILTERS);
    }

    getCollections(options?: Codegen.CollectionListOptions) {
        return this.baseDataService.query<
            Codegen.GetCollectionListQuery,
            Codegen.GetCollectionListQueryVariables
        >(GET_COLLECTION_LIST, {
            options,
        });
    }

    createCollection(input: Codegen.CreateCollectionInput) {
        return this.baseDataService.mutate<
            Codegen.CreateCollectionMutation,
            Codegen.CreateCollectionMutationVariables
        >(CREATE_COLLECTION, {
            input: pick(input, [
                'translations',
                'parentId',
                'assetIds',
                'featuredAssetId',
                'inheritFilters',
                'filters',
                'customFields',
                'isPrivate',
            ]),
        });
    }

    updateCollection(input: Codegen.UpdateCollectionInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateCollectionMutation,
            Codegen.UpdateCollectionMutationVariables
        >(UPDATE_COLLECTION, {
            input: pick(input, [
                'id',
                'isPrivate',
                'translations',
                'assetIds',
                'featuredAssetId',
                'inheritFilters',
                'filters',
                'customFields',
            ]),
        });
    }

    moveCollection(inputs: Codegen.MoveCollectionInput[]) {
        return from(inputs).pipe(
            concatMap(input =>
                this.baseDataService.mutate<
                    Codegen.MoveCollectionMutation,
                    Codegen.MoveCollectionMutationVariables
                >(MOVE_COLLECTION, { input }),
            ),
            bufferCount(inputs.length),
        );
    }

    deleteCollection(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteCollectionMutation,
            Codegen.DeleteCollectionMutationVariables
        >(DELETE_COLLECTION, {
            id,
        });
    }

    deleteCollections(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteCollectionsMutation,
            Codegen.DeleteCollectionsMutationVariables
        >(DELETE_COLLECTIONS, {
            ids,
        });
    }

    previewCollectionVariants(
        input: Codegen.PreviewCollectionVariantsInput,
        options: Codegen.ProductVariantListOptions,
    ) {
        return this.baseDataService.query<
            Codegen.PreviewCollectionContentsQuery,
            Codegen.PreviewCollectionContentsQueryVariables
        >(PREVIEW_COLLECTION_CONTENTS, { input, options });
    }

    getCollectionContents(
        id: string,
        take = 10,
        skip = 0,
        filterTerm?: string,
        options: ExtendedQueryOptions = {},
    ) {
        const filter = filterTerm
            ? ({ name: { contains: filterTerm } } as Codegen.CollectionFilterParameter)
            : undefined;
        return this.baseDataService.query<
            Codegen.GetCollectionContentsQuery,
            Codegen.GetCollectionContentsQueryVariables
        >(
            GET_COLLECTION_CONTENTS,
            {
                id,
                options: {
                    skip,
                    take,
                    filter,
                },
            },
            'cache-and-network',
            options,
        );
    }

    assignCollectionsToChannel(input: Codegen.AssignCollectionsToChannelInput) {
        return this.baseDataService.mutate<
            Codegen.AssignCollectionsToChannelMutation,
            Codegen.AssignCollectionsToChannelMutationVariables
        >(ASSIGN_COLLECTIONS_TO_CHANNEL, {
            input,
        });
    }

    removeCollectionsFromChannel(input: Codegen.RemoveCollectionsFromChannelInput) {
        return this.baseDataService.mutate<
            Codegen.RemoveCollectionsFromChannelMutation,
            Codegen.RemoveCollectionsFromChannelMutationVariables
        >(REMOVE_COLLECTIONS_FROM_CHANNEL, {
            input,
        });
    }
}
