import { Mutation, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Permission, SearchResponse } from '@vendure/common/lib/generated-types';
import { Omit } from '@vendure/common/lib/omit';

import { InternalServerError } from '../../../common/error/errors';
import { Translated } from '../../../common/types/locale-types';
import { Collection, FacetValue } from '../../../entity';
import { Allow } from '../../decorators/allow.decorator';

@Resolver()
export class SearchResolver {
    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    async search(...args: any): Promise<Omit<SearchResponse, 'facetValues' | 'collections'>> {
        throw new InternalServerError('error.no-search-plugin-configured');
    }

    @ResolveField()
    async facetValues(...args: any[]): Promise<Array<{ facetValue: FacetValue; count: number }>> {
        throw new InternalServerError('error.no-search-plugin-configured');
    }

    @ResolveField()
    async collections(...args: any[]): Promise<Array<{ collection: Collection; count: number }>> {
        throw new InternalServerError('error.no-search-plugin-configured');
    }

    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async reindex(...args: any[]): Promise<any> {
        throw new InternalServerError('error.no-search-plugin-configured');
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    async pendingSearchIndexUpdates(...args: any[]): Promise<any> {
        throw new InternalServerError('error.no-search-plugin-configured');
    }

    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async runPendingSearchIndexUpdates(...args: any[]): Promise<any> {
        throw new InternalServerError('error.no-search-plugin-configured');
    }
}
