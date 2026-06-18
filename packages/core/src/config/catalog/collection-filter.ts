import { ConfigArg } from '@vendure/common/lib/generated-types';
import { SelectQueryBuilder } from 'typeorm';

import {
    ConfigArgs,
    ConfigArgValues,
    ConfigurableOperationDef,
    ConfigurableOperationDefOptions,
} from '../../common/configurable-operation';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

export type ApplyCollectionFilterFn<T extends ConfigArgs> = (
    qb: SelectQueryBuilder<ProductVariant>,
    args: ConfigArgValues<T>,
) => SelectQueryBuilder<ProductVariant>;

export interface CollectionFilterConfig<T extends ConfigArgs> extends ConfigurableOperationDefOptions<T> {
    apply: ApplyCollectionFilterFn<T>;
}
/* eslint-disable max-len */
/**
 * @description
 * A CollectionFilter defines a rule which can be used to associate ProductVariants with a Collection.
 * The filtering is done by defining the `apply()` function, which receives a TypeORM
 * [`QueryBuilder`](https://typeorm.io/#/select-query-builder) object to which clauses may be added.
 *
 * Creating a CollectionFilter is considered an advanced Vendure topic. For more insight into how
 * they work, study the [default collection filters](https://github.com/vendurehq/vendure/blob/master/packages/core/src/config/catalog/default-collection-filters.ts)
 *
 * Here's a simple example of a custom CollectionFilter:
 *
 * @example
 * ```ts
 * import { CollectionFilter, LanguageCode } from '\@vendure/core';
 *
 * export const skuCollectionFilter = new CollectionFilter({
 *   args: {
 *     // The `args` object defines the user-configurable arguments
 *     // which will get passed to the filter's `apply()` function.
 *     sku: {
 *       type: 'string',
 *       label: [{ languageCode: LanguageCode.en, value: 'SKU' }],
 *       description: [
 *         {
 *           languageCode: LanguageCode.en,
 *           value: 'Matches any product variants with SKUs containing this value',
 *         },
 *       ],
 *     },
 *   },
 *   code: 'variant-sku-filter',
 *   description: [{ languageCode: LanguageCode.en, value: 'Filter by matching SKU' }],
 *
 *   // This is the function that defines the logic of the filter.
 *   apply: (qb, args) => {
 *     const LIKE = qb.connection.options.type === 'postgres' ? 'ILIKE' : 'LIKE';
 *     return qb.andWhere(`productVariant.sku ${LIKE} :sku`, { sku: `%${args.sku}%` });
 *   },
 * });
 * ```
 *
 * @docsCategory configuration
 */
export class CollectionFilter<T extends ConfigArgs = ConfigArgs> extends ConfigurableOperationDef<T> {
    /* eslint-enable max-len */
    private readonly applyFn: ApplyCollectionFilterFn<T>;
    constructor(config: CollectionFilterConfig<T>) {
        super(config);
        this.applyFn = config.apply;
    }

    apply(qb: SelectQueryBuilder<ProductVariant>, args: ConfigArg[]): SelectQueryBuilder<ProductVariant> {
        return this.applyFn(qb, this.argsArrayToHash(args));
    }
}
