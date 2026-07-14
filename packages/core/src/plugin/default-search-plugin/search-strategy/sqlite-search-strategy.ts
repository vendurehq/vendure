import { LogicalOperator, SearchResult } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { Brackets, SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { Injector } from '../../../common';
import { UserInputError } from '../../../common/error/errors';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { PLUGIN_INIT_OPTIONS } from '../constants';
import { SearchIndexItem } from '../entities/search-index-item.entity';
import { DefaultSearchPluginInitOptions, SearchInput } from '../types';

import { SearchStrategy } from './search-strategy';
import {
    applyLanguageConstraints,
    createCollectionIdCountMap,
    createFacetIdCountMap,
    createPlaceholderFromId,
    mapToSearchResult,
} from './search-strategy-utils';

/**
 *
 * @description
 * A rather naive search for SQLite / SQL.js. Rather than proper
 * full-text searching, it uses a weighted `LIKE "%term%"` operator instead.
 *
 * @docsCategory DefaultSearchPlugin
 */
export class SqliteSearchStrategy implements SearchStrategy {
    private readonly minTermLength = 2;
    private connection: TransactionalConnection;
    private options: DefaultSearchPluginInitOptions;

    async init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        this.options = injector.get(PLUGIN_INIT_OPTIONS);
    }

    async getFacetValueIds(
        ctx: RequestContext,
        input: SearchInput,
        enabledOnly: boolean,
    ): Promise<Map<ID, number>> {
        const facetValuesQb = this.connection
            .getRepository(ctx, SearchIndexItem)
            .createQueryBuilder('si')
            .select(['si.productId', 'si.productVariantId'])
            .addSelect('GROUP_CONCAT(si.facetValueIds)', 'facetValues');

        this.applyTermAndFilters(ctx, facetValuesQb, input);
        if (!input.groupByProduct) {
            facetValuesQb.groupBy('si.productVariantId');
        }
        if (enabledOnly) {
            facetValuesQb.andWhere('si.enabled = :enabled', { enabled: true });
        }
        const facetValuesResult = await facetValuesQb.getRawMany();
        return createFacetIdCountMap(facetValuesResult);
    }

    async getCollectionIds(
        ctx: RequestContext,
        input: SearchInput,
        enabledOnly: boolean,
    ): Promise<Map<ID, number>> {
        const collectionsQb = this.connection
            .getRepository(ctx, SearchIndexItem)
            .createQueryBuilder('si')
            .select(['si.productId', 'si.productVariantId'])
            .addSelect('GROUP_CONCAT(si.collectionIds)', 'collections');

        this.applyTermAndFilters(ctx, collectionsQb, input);
        if (!input.groupByProduct) {
            collectionsQb.groupBy('si.productVariantId');
        }
        if (enabledOnly) {
            collectionsQb.andWhere('si.enabled = :enabled', { enabled: true });
        }
        const collectionsResult = await collectionsQb.getRawMany();
        return createCollectionIdCountMap(collectionsResult);
    }

    async getSearchResults(
        ctx: RequestContext,
        input: SearchInput,
        enabledOnly: boolean,
    ): Promise<SearchResult[]> {
        const take = input.take || 25;
        const skip = input.skip || 0;
        const sort = input.sort;
        const qb = this.connection.getRepository(ctx, SearchIndexItem).createQueryBuilder('si');
        if (input.groupByProduct) {
            qb.addSelect('MIN(si.price)', 'minPrice');
            qb.addSelect('MAX(si.price)', 'maxPrice');
            qb.addSelect('MIN(si.priceWithTax)', 'minPriceWithTax');
            qb.addSelect('MAX(si.priceWithTax)', 'maxPriceWithTax');
        }

        this.applyTermAndFilters(ctx, qb, input);

        if (sort) {
            if (sort.name) {
                // TODO: v3 - set the collation on the SearchIndexItem entity
                qb.addOrderBy('si.productName COLLATE NOCASE', sort.name);
            }
            if (sort.price) {
                qb.addOrderBy('si.price', sort.price);
            }
        } else if (input.term && input.term.length > this.minTermLength) {
            qb.addOrderBy('score', 'DESC');
        }

        // Required to ensure deterministic sorting.
        // E.g. in case of sorting products with duplicate name, price or score results.
        qb.addOrderBy('si.productVariantId', 'ASC');

        if (enabledOnly) {
            qb.andWhere('si.enabled = :enabled', { enabled: true });
        }

        return await qb
            .limit(take)
            .offset(skip)
            .getRawMany()
            .then(res => res.map(r => mapToSearchResult(r, ctx.channel.defaultCurrencyCode)));
    }

    async getTotalCount(ctx: RequestContext, input: SearchInput, enabledOnly: boolean): Promise<number> {
        const innerQb = this.applyTermAndFilters(
            ctx,
            this.connection.getRepository(ctx, SearchIndexItem).createQueryBuilder('si'),
            input,
        );

        if (enabledOnly) {
            innerQb.andWhere('si.enabled = :enabled', { enabled: true });
        }

        const totalItemsQb = this.connection.rawConnection
            .createQueryBuilder()
            .select('COUNT(*) as total')
            .from(`(${innerQb.getQuery()})`, 'inner')
            .setParameters(innerQb.getParameters());
        return totalItemsQb.getRawOne().then(res => res.total);
    }

    private applyTermAndFilters(
        ctx: RequestContext,
        qb: SelectQueryBuilder<SearchIndexItem>,
        input: SearchInput,
    ): SelectQueryBuilder<SearchIndexItem> {
        const {
            term,
            facetValueFilters,
            facetValueIds,
            facetValueOperator,
            collectionId,
            collectionSlug,
            collectionIds,
            collectionSlugs,
        } = input;

        qb.where('1 = 1');
        if (term && term.length > this.minTermLength) {
            // Note: SQLite does not natively have fulltext search capabilities,
            // so we just use a weighted LIKE match
            qb.addSelect(
                `
                    CASE WHEN si.sku LIKE :like_term THEN 10 ELSE 0 END +
                    CASE WHEN si.productName LIKE :like_term THEN 3 ELSE 0 END +
                    CASE WHEN si.productVariantName LIKE :like_term THEN 2 ELSE 0 END +
                    CASE WHEN si.description LIKE :like_term THEN 1 ELSE 0 END`,
                'score',
            )
                .andWhere(
                    new Brackets(qb1 => {
                        qb1.where('si.sku LIKE :like_term')
                            .orWhere('si.productName LIKE :like_term')
                            .orWhere('si.productVariantName LIKE :like_term')
                            .orWhere('si.description LIKE :like_term');
                    }),
                )
                .setParameters({ term, like_term: `%${term}%` });
        }
        if (input.inStock != null) {
            if (input.groupByProduct) {
                qb.andWhere('si.productInStock = :inStock', { inStock: input.inStock });
            } else {
                qb.andWhere('si.inStock = :inStock', { inStock: input.inStock });
            }
        }
        if (facetValueIds?.length) {
            qb.andWhere(
                new Brackets(qb1 => {
                    for (const id of facetValueIds) {
                        const placeholder = createPlaceholderFromId(id);
                        const clause = `(',' || si.facetValueIds || ',') LIKE :${placeholder}`;
                        const params = { [placeholder]: `%,${id},%` };
                        if (facetValueOperator === LogicalOperator.AND) {
                            qb1.andWhere(clause, params);
                        } else {
                            qb1.orWhere(clause, params);
                        }
                    }
                }),
            );
        }
        if (facetValueFilters?.length) {
            qb.andWhere(
                new Brackets(qb1 => {
                    for (const facetValueFilter of facetValueFilters) {
                        qb1.andWhere(
                            new Brackets(qb2 => {
                                if (facetValueFilter.and && facetValueFilter.or?.length) {
                                    throw new UserInputError('error.facetfilterinput-invalid-input');
                                }
                                if (facetValueFilter.and) {
                                    const placeholder = createPlaceholderFromId(facetValueFilter.and);
                                    const clause = `(',' || si.facetValueIds || ',') LIKE :${placeholder}`;
                                    const params = { [placeholder]: `%,${facetValueFilter.and},%` };
                                    qb2.where(clause, params);
                                }
                                if (facetValueFilter.or?.length) {
                                    for (const id of facetValueFilter.or) {
                                        const placeholder = createPlaceholderFromId(id);
                                        const clause = `(',' || si.facetValueIds || ',') LIKE :${placeholder}`;
                                        const params = { [placeholder]: `%,${id},%` };
                                        qb2.orWhere(clause, params);
                                    }
                                }
                            }),
                        );
                    }
                }),
            );
        }
        if (collectionId) {
            qb.andWhere("(',' || si.collectionIds || ',') LIKE :collectionId", {
                collectionId: `%,${collectionId},%`,
            });
        }
        if (collectionSlug) {
            qb.andWhere("(',' || si.collectionSlugs || ',') LIKE :collectionSlug", {
                collectionSlug: `%,${collectionSlug},%`,
            });
        }
        if (collectionIds?.length) {
            qb.andWhere(
                new Brackets(qb1 => {
                    for (const id of Array.from(new Set(collectionIds))) {
                        const placeholder = createPlaceholderFromId(id);
                        qb1.orWhere(`(',' || si.collectionIds || ',') LIKE :${placeholder}`, {
                            [placeholder]: `%,${id},%`,
                        });
                    }
                }),
            );
        }
        if (collectionSlugs?.length) {
            qb.andWhere(
                new Brackets(qb1 => {
                    for (const slug of Array.from(new Set(collectionSlugs))) {
                        const placeholder = createPlaceholderFromId(slug);
                        qb1.orWhere(`(',' || si.collectionSlugs || ',') LIKE :${placeholder}`, {
                            [placeholder]: `%,${slug},%`,
                        });
                    }
                }),
            );
        }

        qb.andWhere('si.channelId = :channelId', { channelId: ctx.channelId });
        applyLanguageConstraints(qb, ctx.languageCode, ctx.channel.defaultLanguageCode);

        if (input.groupByProduct === true) {
            qb.groupBy('si.productId');
        }

        return qb;
    }
}
