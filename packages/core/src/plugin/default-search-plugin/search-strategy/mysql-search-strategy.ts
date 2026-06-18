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
import { getFieldsToSelect } from './search-strategy-common';
import {
    applyLanguageConstraints,
    createCollectionIdCountMap,
    createFacetIdCountMap,
    createPlaceholderFromId,
    mapToSearchResult,
} from './search-strategy-utils';

/**
 * @description A weighted fulltext search for MySQL / MariaDB.
 *
 * @docsCategory DefaultSearchPlugin
 */
export class MysqlSearchStrategy implements SearchStrategy {
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
            .select(['MIN(si.productId)', 'MIN(si.productVariantId)'])
            .addSelect('GROUP_CONCAT(si.facetValueIds)', 'facetValues');

        this.applyTermAndFilters(ctx, facetValuesQb, { ...input, groupByProduct: true });
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
            .select(['MIN(si.productId)', 'MIN(si.productVariantId)'])
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
        const qb = this.connection
            .getRepository(ctx, SearchIndexItem)
            .createQueryBuilder('si')
            .select(this.createMysqlSelect(!!input.groupByProduct));
        if (input.groupByProduct) {
            qb.addSelect('MIN(si.price)', 'minPrice')
                .addSelect('MAX(si.price)', 'maxPrice')
                .addSelect('MIN(si.priceWithTax)', 'minPriceWithTax')
                .addSelect('MAX(si.priceWithTax)', 'maxPriceWithTax');
        }

        this.applyTermAndFilters(ctx, qb, input);

        if (sort) {
            if (sort.name) {
                qb.addOrderBy('si_productName', sort.name);
            }
            if (sort.price) {
                qb.addOrderBy('si_price', sort.price);
            }
        } else if (input.term && input.term.length > this.minTermLength) {
            qb.addOrderBy('score', 'DESC');
        }

        // Required to ensure deterministic sorting.
        // E.g. in case of sorting products with duplicate name, price or score results.
        qb.addOrderBy('si_productVariantId', 'ASC');

        if (enabledOnly) {
            qb.andWhere('si.enabled = :enabled', { enabled: true });
        }

        return qb
            .limit(take)
            .offset(skip)
            .getRawMany()
            .then(res =>
                res.map(r =>
                    mapToSearchResult(
                        r,
                        this.options.indexCurrencyCode ? r.si_currencyCode : ctx.channel.defaultCurrencyCode,
                    ),
                ),
            );
    }

    async getTotalCount(ctx: RequestContext, input: SearchInput, enabledOnly: boolean): Promise<number> {
        const innerQb = this.applyTermAndFilters(
            ctx,
            this.connection
                .getRepository(ctx, SearchIndexItem)
                .createQueryBuilder('si')
                .select(this.createMysqlSelect(!!input.groupByProduct)),
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

        if (term && term.length > this.minTermLength) {
            const safeTerm = term
                .replace(/"/g, '')
                .replace(/@/g, ' ')
                .trim()
                .replace(/[+\-*~<>]/g, ' ')
                .trim();
            const termScoreQuery = this.connection
                .getRepository(ctx, SearchIndexItem)
                .createQueryBuilder('si_inner')
                .select('si_inner.productId', 'inner_productId')
                .addSelect('si_inner.productVariantId', 'inner_productVariantId')
                .addSelect('IF (si_inner.sku LIKE :like_term, 10, 0)', 'sku_score')
                .addSelect(
                    `(SELECT sku_score) +
                     MATCH (si_inner.productName) AGAINST (:term IN BOOLEAN MODE) * 2 +
                     MATCH (si_inner.productVariantName) AGAINST (:term IN BOOLEAN MODE) * 1.5 +
                     MATCH (si_inner.description) AGAINST (:term IN BOOLEAN MODE) * 1`,
                    'score',
                )
                .where(
                    new Brackets(qb1 => {
                        qb1.where('si_inner.sku LIKE :like_term')
                            .orWhere('MATCH (si_inner.productName) AGAINST (:term IN BOOLEAN MODE)')
                            .orWhere('MATCH (si_inner.productVariantName) AGAINST (:term IN BOOLEAN MODE)')
                            .orWhere('MATCH (si_inner.description) AGAINST (:term IN BOOLEAN MODE)');
                    }),
                )
                .andWhere('si_inner.channelId = :channelId')
                .setParameters({
                    term: `${safeTerm}*`,
                    like_term: `%${safeTerm}%`,
                    channelId: ctx.channelId,
                });

            qb.innerJoin(`(${termScoreQuery.getQuery()})`, 'term_result', 'inner_productId = si.productId')
                .addSelect(input.groupByProduct ? 'MAX(term_result.score)' : 'term_result.score', 'score')
                .andWhere('term_result.inner_productVariantId = si.productVariantId')
                .setParameters(termScoreQuery.getParameters());
        } else {
            qb.addSelect('1 as score');
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
                        const clause = `FIND_IN_SET(:${placeholder}, si.facetValueIds)`;
                        const params = { [placeholder]: id };
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
                                    const clause = `FIND_IN_SET(:${placeholder}, si.facetValueIds)`;
                                    const params = { [placeholder]: facetValueFilter.and };
                                    qb2.where(clause, params);
                                }
                                if (facetValueFilter.or?.length) {
                                    for (const id of facetValueFilter.or) {
                                        const placeholder = createPlaceholderFromId(id);
                                        const clause = `FIND_IN_SET(:${placeholder}, si.facetValueIds)`;
                                        const params = { [placeholder]: id };
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
            qb.andWhere('FIND_IN_SET (:collectionId, si.collectionIds)', { collectionId });
        }
        if (collectionSlug) {
            qb.andWhere('FIND_IN_SET (:collectionSlug, si.collectionSlugs)', { collectionSlug });
        }
        if (collectionIds?.length) {
            qb.andWhere(
                new Brackets(qb1 => {
                    for (const id of Array.from(new Set(collectionIds))) {
                        const placeholder = createPlaceholderFromId(id);
                        qb1.orWhere(`FIND_IN_SET(:${placeholder}, si.collectionIds)`, {
                            [placeholder]: id,
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
                        qb1.orWhere(`FIND_IN_SET(:${placeholder}, si.collectionSlugs)`, {
                            [placeholder]: slug,
                        });
                    }
                }),
            );
        }

        qb.andWhere('si.channelId = :channelId', { channelId: ctx.channelId });
        applyLanguageConstraints(qb, ctx.languageCode, ctx.channel.defaultLanguageCode);

        if (this.options.indexCurrencyCode) {
            qb.andWhere('si.currencyCode = :currencyCode', { currencyCode: ctx.currencyCode });
        }

        if (input.groupByProduct === true) {
            qb.groupBy('si.productId');
            qb.addSelect('BIT_OR(si.enabled)', 'productEnabled');
        }
        return qb;
    }

    /**
     * When a select statement includes a GROUP BY clause,
     * then all selected columns must be aggregated. So we just apply the
     * "MIN" function in this case to all other columns than the productId.
     */
    private createMysqlSelect(groupByProduct: boolean): string {
        return getFieldsToSelect(this.options.indexStockStatus, this.options.indexCurrencyCode)
            .map(col => {
                const qualifiedName = `si.${col}`;
                const alias = `si_${col}`;
                if (groupByProduct && col !== 'productId') {
                    if (
                        col === 'facetIds' ||
                        col === 'facetValueIds' ||
                        col === 'collectionIds' ||
                        col === 'channelIds'
                    ) {
                        return `GROUP_CONCAT(${qualifiedName}) as "${alias}"`;
                    } else if (col === 'enabled' || col === 'inStock' || col === 'productInStock') {
                        return `MAX(${qualifiedName}) as "${alias}"`;
                    } else {
                        return `MIN(${qualifiedName}) as "${alias}"`;
                    }
                } else {
                    return `${qualifiedName} as "${alias}"`;
                }
            })
            .join(', ');
    }
}
