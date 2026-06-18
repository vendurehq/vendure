import { Inject, Injectable } from '@nestjs/common';
import { SearchInput, SearchResponse } from '@vendure/common/lib/generated-types';
import { Omit } from '@vendure/common/lib/omit';

import { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Collection, FacetValue } from '../../entity';
import { EventBus } from '../../event-bus/event-bus';
import { SearchEvent } from '../../event-bus/events/search-event';
import { Job } from '../../job-queue/job';
import { CollectionService } from '../../service/services/collection.service';
import { FacetValueService } from '../../service/services/facet-value.service';
import { ProductVariantService } from '../../service/services/product-variant.service';
import { SearchService } from '../../service/services/search.service';

import { PLUGIN_INIT_OPTIONS } from './constants';
import { SearchIndexService } from './indexer/search-index.service';
import { MysqlSearchStrategy } from './search-strategy/mysql-search-strategy';
import { PostgresSearchStrategy } from './search-strategy/postgres-search-strategy';
import { SearchStrategy } from './search-strategy/search-strategy';
import { SqliteSearchStrategy } from './search-strategy/sqlite-search-strategy';
import { DefaultSearchPluginInitOptions } from './types';

/**
 * Search indexing and full-text search for supported databases. See the various
 * SearchStrategy implementations for db-specific code.
 */
@Injectable()
export class FulltextSearchService {
    private _searchStrategy: SearchStrategy;
    private readonly minTermLength = 2;

    constructor(
        private connection: TransactionalConnection,
        private eventBus: EventBus,
        private facetValueService: FacetValueService,
        private collectionService: CollectionService,
        private productVariantService: ProductVariantService,
        private searchIndexService: SearchIndexService,
        private searchService: SearchService,
        @Inject(PLUGIN_INIT_OPTIONS) private options: DefaultSearchPluginInitOptions,
    ) {
        this.searchService.adopt(this);
        this.setSearchStrategy();
    }

    /**
     * Perform a fulltext search according to the provided input arguments.
     */
    async search(
        ctx: RequestContext,
        input: SearchInput,
        enabledOnly: boolean = false,
    ): Promise<Omit<Omit<SearchResponse, 'facetValues'>, 'collections'>> {
        const items = await this._searchStrategy.getSearchResults(ctx, input, enabledOnly);
        const totalItems = await this._searchStrategy.getTotalCount(ctx, input, enabledOnly);
        await this.eventBus.publish(new SearchEvent(ctx, input));

        return {
            items,
            totalItems,
        };
    }

    /**
     * Return a list of all FacetValues which appear in the result set.
     */
    async facetValues(
        ctx: RequestContext,
        input: SearchInput,
        enabledOnly: boolean = false,
    ): Promise<Array<{ facetValue: FacetValue; count: number }>> {
        const facetValueIdsMap = await this._searchStrategy.getFacetValueIds(ctx, input, enabledOnly);
        const facetValues = await this.facetValueService.findByIds(ctx, Array.from(facetValueIdsMap.keys()));
        return facetValues.map((facetValue, index) => {
            return {
                facetValue,
                count: facetValueIdsMap.get(facetValue.id.toString()) as number,
            };
        });
    }

    /**
     * Return a list of all Collections which appear in the result set.
     */
    async collections(
        ctx: RequestContext,
        input: SearchInput,
        enabledOnly: boolean = false,
    ): Promise<Array<{ collection: Collection; count: number }>> {
        const collectionIdsMap = await this._searchStrategy.getCollectionIds(ctx, input, enabledOnly);
        const collections = await this.collectionService.findByIds(ctx, Array.from(collectionIdsMap.keys()));
        return collections.map((collection, index) => {
            return {
                collection,
                count: collectionIdsMap.get(collection.id.toString()) as number,
            };
        });
    }

    /**
     * Rebuilds the full search index.
     */
    async reindex(ctx: RequestContext): Promise<Job> {
        const job = await this.searchIndexService.reindex(ctx);
        return job as any;
    }

    /**
     * Sets the SearchStrategy appropriate to th configured database type.
     */
    private setSearchStrategy() {
        if (this.options.searchStrategy) {
            this._searchStrategy = this.options.searchStrategy;
        } else {
            switch (this.connection.rawConnection.options.type) {
                case 'mysql':
                case 'mariadb':
                case 'aurora-mysql':
                    this._searchStrategy = new MysqlSearchStrategy();
                    break;
                case 'sqlite':
                case 'sqljs':
                case 'better-sqlite3':
                    this._searchStrategy = new SqliteSearchStrategy();
                    break;
                case 'postgres':
                case 'aurora-postgres':
                case 'cockroachdb':
                    this._searchStrategy = new PostgresSearchStrategy();
                    break;
                default:
                    throw new InternalServerError('error.database-not-supported-by-default-search-plugin');
            }
        }
    }

    public get searchStrategy(): SearchStrategy {
        return this._searchStrategy;
    }
}
