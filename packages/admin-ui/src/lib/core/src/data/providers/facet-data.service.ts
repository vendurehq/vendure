import { WatchQueryFetchPolicy } from '@apollo/client/core';
import { pick } from '@vendure/common/lib/pick';

import * as Codegen from '../../common/generated-types';
import {
    ASSIGN_FACETS_TO_CHANNEL,
    CREATE_FACET,
    CREATE_FACET_VALUES,
    DELETE_FACET,
    DELETE_FACET_VALUES,
    DELETE_FACETS,
    GET_FACET_VALUE_LIST,
    REMOVE_FACETS_FROM_CHANNEL,
    UPDATE_FACET,
    UPDATE_FACET_VALUES,
} from '../definitions/facet-definitions';

import { BaseDataService } from './base-data.service';

export class FacetDataService {
    constructor(private baseDataService: BaseDataService) {}

    getFacetValues(options: Codegen.FacetValueListOptions, fetchPolicy?: WatchQueryFetchPolicy) {
        return this.baseDataService.query<
            Codegen.GetFacetValueListQuery,
            Codegen.GetFacetValueListQueryVariables
        >(GET_FACET_VALUE_LIST, { options }, fetchPolicy);
    }

    createFacet(facet: Codegen.CreateFacetInput) {
        const input: Codegen.CreateFacetMutationVariables = {
            input: pick(facet, ['code', 'isPrivate', 'translations', 'values', 'customFields']),
        };
        return this.baseDataService.mutate<Codegen.CreateFacetMutation, Codegen.CreateFacetMutationVariables>(
            CREATE_FACET,
            input,
        );
    }

    updateFacet(facet: Codegen.UpdateFacetInput) {
        const input: Codegen.UpdateFacetMutationVariables = {
            input: pick(facet, ['id', 'code', 'isPrivate', 'translations', 'customFields']),
        };
        return this.baseDataService.mutate<Codegen.UpdateFacetMutation, Codegen.UpdateFacetMutationVariables>(
            UPDATE_FACET,
            input,
        );
    }

    deleteFacet(id: string, force: boolean) {
        return this.baseDataService.mutate<Codegen.DeleteFacetMutation, Codegen.DeleteFacetMutationVariables>(
            DELETE_FACET,
            {
                id,
                force,
            },
        );
    }

    deleteFacets(ids: string[], force: boolean) {
        return this.baseDataService.mutate<
            Codegen.DeleteFacetsMutation,
            Codegen.DeleteFacetsMutationVariables
        >(DELETE_FACETS, {
            ids,
            force,
        });
    }

    createFacetValues(facetValues: Codegen.CreateFacetValueInput[]) {
        const input: Codegen.CreateFacetValuesMutationVariables = {
            input: facetValues.map(pick(['facetId', 'code', 'translations', 'customFields'])),
        };
        return this.baseDataService.mutate<
            Codegen.CreateFacetValuesMutation,
            Codegen.CreateFacetValuesMutationVariables
        >(CREATE_FACET_VALUES, input);
    }

    updateFacetValues(facetValues: Codegen.UpdateFacetValueInput[]) {
        const input: Codegen.UpdateFacetValuesMutationVariables = {
            input: facetValues.map(pick(['id', 'code', 'translations', 'customFields'])),
        };
        return this.baseDataService.mutate<
            Codegen.UpdateFacetValuesMutation,
            Codegen.UpdateFacetValuesMutationVariables
        >(UPDATE_FACET_VALUES, input);
    }

    deleteFacetValues(ids: string[], force: boolean) {
        return this.baseDataService.mutate<
            Codegen.DeleteFacetValuesMutation,
            Codegen.DeleteFacetValuesMutationVariables
        >(DELETE_FACET_VALUES, {
            ids,
            force,
        });
    }

    assignFacetsToChannel(input: Codegen.AssignFacetsToChannelInput) {
        return this.baseDataService.mutate<
            Codegen.AssignFacetsToChannelMutation,
            Codegen.AssignFacetsToChannelMutationVariables
        >(ASSIGN_FACETS_TO_CHANNEL, {
            input,
        });
    }

    removeFacetsFromChannel(input: Codegen.RemoveFacetsFromChannelInput) {
        return this.baseDataService.mutate<
            Codegen.RemoveFacetsFromChannelMutation,
            Codegen.RemoveFacetsFromChannelMutationVariables
        >(REMOVE_FACETS_FROM_CHANNEL, {
            input,
        });
    }
}
