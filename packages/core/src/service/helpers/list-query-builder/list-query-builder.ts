import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { LogicalOperator } from '@vendure/common/lib/generated-types';
import { ID, Type } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import {
    Brackets,
    FindOneOptions,
    FindOptionsWhere,
    Repository,
    SelectQueryBuilder,
    WhereExpressionBuilder,
} from 'typeorm';
import { BetterSqlite3Driver } from 'typeorm/driver/better-sqlite3/BetterSqlite3Driver';
import { SqljsDriver } from 'typeorm/driver/sqljs/SqljsDriver';

import { ApiType, RequestContext } from '../../../api';
import {
    FilterParameter,
    ListQueryOptions,
    NullOptionals,
    SortParameter,
    UserInputError,
} from '../../../common';
import { Instrument } from '../../../common/instrument-decorator';
import { ConfigService, CustomFields, Logger } from '../../../config';
import { TransactionalConnection } from '../../../connection';
import { VendureEntity } from '../../../entity';
import { joinTreeRelationsDynamically } from '../utils/tree-relations-qb-joiner';

import { getColumnMetadata, getEntityAlias } from './connection-utils';
import { getCalculatedColumns } from './get-calculated-columns';
import { parseFilterParams, WhereCondition, WhereGroup } from './parse-filter-params';
import { parseSortParams } from './parse-sort-params';

/**
 * Counter for generating unique aliases in EXISTS subqueries.
 * Using a module-level counter ensures uniqueness across all queries in a session.
 */
let existsSubqueryCounter = 0;

/**
 * @description
 * Options which can be passed to the ListQueryBuilder's `build()` method.
 *
 * @docsCategory data-access
 * @docsPage ListQueryBuilder
 */
export type ExtendedListQueryOptions<T extends VendureEntity> = {
    relations?: string[];
    channelId?: ID;
    where?: FindOptionsWhere<T>;
    orderBy?: FindOneOptions<T>['order'];
    /**
     * @description
     * Allows you to specify the alias used for the entity `T` in the generated SQL query.
     * Defaults to the entity class name lower-cased, i.e. `ProductVariant` -> `'productvariant'`.
     *
     * @since 1.6.0
     */
    entityAlias?: string;
    /**
     * @description
     * When a RequestContext is passed, then the query will be
     * executed as part of any outer transaction.
     */
    ctx?: RequestContext;
    /**
     * @description
     * One of the main tasks of the ListQueryBuilder is to auto-generate filter and sort queries based on the
     * available columns of a given entity. However, it may also be sometimes desirable to allow filter/sort
     * on a property of a relation. In this case, the `customPropertyMap` can be used to define a property
     * of the `options.sort` or `options.filter` which does not correspond to a direct column of the current
     * entity, and then provide a mapping to the related property to be sorted/filtered.
     *
     * Example: we want to allow sort/filter by and Order's `customerLastName`. The actual lastName property is
     * not a column in the Order table, it exists on the Customer entity, and Order has a relation to Customer via
     * `Order.customer`. Therefore, we can define a customPropertyMap like this:
     *
     * @example
     * ```GraphQL
     * """
     * Manually extend the filter & sort inputs to include the new
     * field that we want to be able to use in building list queries.
     * """
     * input OrderFilterParameter {
     *     customerLastName: StringOperators
     * }
     *
     * input OrderSortParameter {
     *     customerLastName: SortOrder
     * }
     * ```
     *
     * @example
     * ```ts
     * const qb = this.listQueryBuilder.build(Order, options, {
     *   relations: ['customer'],
     *   customPropertyMap: {
     *     // Tell TypeORM how to map that custom
     *     // sort/filter field to the property on a
     *     // related entity.
     *     customerLastName: 'customer.lastName',
     *   },
     * };
     * ```
     * We can now use the `customerLastName` property to filter or sort
     * on the list query:
     *
     * @example
     * ```GraphQL
     * query {
     *   myOrderQuery(options: {
     *     filter: {
     *       customerLastName: { contains: "sm" }
     *     }
     *   }) {
     *     # ...
     *   }
     * }
     * ```
     */
    customPropertyMap?: { [name: string]: string };
    /**
     * @description
     * When set to `true`, the configured `shopListQueryLimit` and `adminListQueryLimit` values will be ignored,
     * allowing unlimited results to be returned. Use caution when exposing an unlimited list query to the public,
     * as it could become a vector for a denial of service attack if an attacker requests a very large list.
     *
     * @since 2.0.2
     * @default false
     */
    ignoreQueryLimits?: boolean;
};

/**
 * @description
 * This helper class is used when fetching entities the database from queries which return a {@link PaginatedList} type.
 * These queries all follow the same format:
 *
 * In the GraphQL definition, they return a type which implements the `Node` interface, and the query returns a
 * type which implements the `PaginatedList` interface:
 *
 * ```GraphQL
 * type BlogPost implements Node {
 *   id: ID!
 *   published: DateTime!
 *   title: String!
 *   body: String!
 * }
 *
 * type BlogPostList implements PaginatedList {
 *   items: [BlogPost!]!
 *   totalItems: Int!
 * }
 *
 * # Generated at run-time by Vendure
 * input BlogPostListOptions
 *
 * extend type Query {
 *    blogPosts(options: BlogPostListOptions): BlogPostList!
 * }
 * ```
 * When Vendure bootstraps, it will find the `BlogPostListOptions` input and, because it is used in a query
 * returning a `PaginatedList` type, it knows that it should dynamically generate this input. This means
 * all primitive field of the `BlogPost` type (namely, "published", "title" and "body") will have `filter` and
 * `sort` inputs created for them, as well a `skip` and `take` fields for pagination.
 *
 * Your resolver function will then look like this:
 *
 * ```ts
 * \@Resolver()
 * export class BlogPostResolver
 *   constructor(private blogPostService: BlogPostService) {}
 *
 *   \@Query()
 *   async blogPosts(
 *     \@Ctx() ctx: RequestContext,
 *     \@Args() args: any,
 *   ): Promise<PaginatedList<BlogPost>> {
 *     return this.blogPostService.findAll(ctx, args.options || undefined);
 *   }
 * }
 * ```
 *
 * and the corresponding service will use the ListQueryBuilder:
 *
 * ```ts
 * \@Injectable()
 * export class BlogPostService {
 *   constructor(private listQueryBuilder: ListQueryBuilder) {}
 *
 *   findAll(ctx: RequestContext, options?: ListQueryOptions<BlogPost>) {
 *     return this.listQueryBuilder
 *       .build(BlogPost, options)
 *       .getManyAndCount()
 *       .then(async ([items, totalItems]) => {
 *         return { items, totalItems };
 *       });
 *   }
 * }
 * ```
 *
 * @docsCategory data-access
 * @docsPage ListQueryBuilder
 * @docsWeight 0
 */
@Injectable()
@Instrument()
export class ListQueryBuilder implements OnApplicationBootstrap {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
    ) {}

    /** @internal */
    onApplicationBootstrap(): any {
        this.registerSQLiteRegexpFunction();
    }

    /**
     * @description
     * Used to determine whether a list query `filter` object contains the
     * given property, either at the top level or nested inside a boolean
     * `_and` or `_or` expression.
     *
     * This is useful when a custom property map is used to map a filter
     * field to a related entity, and we need to determine whether the
     * filter object contains that property, which then means we would need
     * to join that relation.
     */
    filterObjectHasProperty<FP extends FilterParameter<VendureEntity>>(
        filterObject: FP | NullOptionals<FP> | null | undefined,
        property: keyof FP,
    ): boolean {
        if (!filterObject) {
            return false;
        }
        for (const key in filterObject) {
            if (!filterObject[key]) {
                continue;
            }
            if (key === property) {
                return true;
            }
            if (key === '_and' || key === '_or') {
                const value = filterObject[key] as FP[];
                for (const condition of value) {
                    if (this.filterObjectHasProperty(condition, property)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /*
     * @description
     * Creates and configures a SelectQueryBuilder for queries that return paginated lists of entities.
     */
    build<T extends VendureEntity>(
        entity: Type<T>,
        options: ListQueryOptions<T> = {},
        extendedOptions: ExtendedListQueryOptions<T> = {},
    ): SelectQueryBuilder<T> {
        const apiType = extendedOptions.ctx?.apiType ?? 'shop';
        const { take, skip } = this.parseTakeSkipParams(apiType, options, extendedOptions.ignoreQueryLimits);

        const repo = extendedOptions.ctx
            ? this.connection.getRepository(extendedOptions.ctx, entity)
            : this.connection.rawConnection.getRepository(entity);
        const alias = extendedOptions.entityAlias || entity.name.toLowerCase();
        const minimumRequiredRelations = this.getMinimumRequiredRelations(repo, options, extendedOptions);
        const qb = repo.createQueryBuilder(alias);

        let relations = unique([...minimumRequiredRelations, ...(extendedOptions?.relations ?? [])]);

        // Special case for the 'collection' entity, which has a complex nested structure
        // and requires special handling to ensure that only the necessary relations are joined.
        // This is bypassed an issue in TypeORM where it would join the same relation multiple times.
        // See https://github.com/typeorm/typeorm/issues/9936 for more context.
        const processedRelations = joinTreeRelationsDynamically(qb, entity, relations);

        // Remove any relations which are related to the 'collection' tree, as these are handled separately
        // to avoid duplicate joins.
        relations = relations.filter(relationPath => !processedRelations.has(relationPath));

        qb.setFindOptions({
            relations,
            take,
            skip,
            where: extendedOptions.where || {},
            relationLoadStrategy: 'query',
        });

        // join the tables required by calculated columns
        this.joinCalculatedColumnRelations(qb, entity, options);

        const { customPropertyMap } = extendedOptions;
        // Store the original customPropertyMap before normalization for EXISTS subquery generation.
        // This is needed because normalizeCustomPropertyMap mutates customPropertyMap, but
        // parseFilterParams needs the original paths to detect *-to-Many relations.
        const originalCustomPropertyMap = customPropertyMap ? { ...customPropertyMap } : undefined;
        if (customPropertyMap) {
            this.normalizeCustomPropertyMap(customPropertyMap, options, qb);
        }

        const customFieldsForType = this.configService.customFields[entity.name as keyof CustomFields];
        const sortParams = Object.assign({}, options.sort, extendedOptions.orderBy);
        this.applyTranslationConditions(qb, entity, sortParams, extendedOptions.ctx);
        const sort = parseSortParams(
            qb.connection,
            entity,
            sortParams,
            customPropertyMap,
            qb.alias,
            customFieldsForType,
        );

        const filter = parseFilterParams({
            connection: qb.connection,
            entity,
            filterParams: options.filter,
            customPropertyMap,
            originalCustomPropertyMap,
            entityAlias: qb.alias,
        });

        if (filter.length) {
            const filterOperator = options.filterOperator ?? LogicalOperator.AND;
            qb.andWhere(
                new Brackets(qb1 => {
                    for (const condition of filter) {
                        if ('conditions' in condition) {
                            this.addNestedWhereClause(qb1, condition, filterOperator, qb, entity);
                        } else {
                            this.applyWhereCondition(qb1, condition, filterOperator, qb, entity);
                        }
                    }
                }),
            );
        }

        if (extendedOptions.channelId) {
            qb.innerJoin(`${qb.alias}.channels`, 'lqb__channel', 'lqb__channel.id = :channelId', {
                channelId: extendedOptions.channelId,
            });
        }

        qb.orderBy(sort);
        // Note: EntityAccessControlStrategy.applyAccessControl() is NOT called explicitly
        // here. When a strategy is configured, the QueryBuilder returned from
        // getRepository(ctx, entity).createQueryBuilder() is Proxy-wrapped, and the
        // strategy is applied automatically before any terminal method (getMany, getCount, etc.).
        return qb;
    }

    private addNestedWhereClause<T extends VendureEntity>(
        qb: WhereExpressionBuilder,
        whereGroup: WhereGroup,
        parentOperator: LogicalOperator,
        mainQb: SelectQueryBuilder<T>,
        entity: Type<T>,
    ) {
        if (whereGroup.conditions.length) {
            const subQb = new Brackets(qb1 => {
                whereGroup.conditions.forEach(condition => {
                    if ('conditions' in condition) {
                        this.addNestedWhereClause(qb1, condition, whereGroup.operator, mainQb, entity);
                    } else {
                        this.applyWhereCondition(qb1, condition, whereGroup.operator, mainQb, entity);
                    }
                });
            });
            if (parentOperator === LogicalOperator.AND) {
                qb.andWhere(subQb);
            } else {
                qb.orWhere(subQb);
            }
        }
    }

    /**
     * Applies a WHERE condition to the query builder. For conditions that need EXISTS subquery
     * treatment (duplicate custom property fields in _and blocks), generates an EXISTS subquery
     * instead of a simple WHERE clause.
     */
    private applyWhereCondition<T extends VendureEntity>(
        qb: WhereExpressionBuilder,
        condition: WhereCondition,
        operator: LogicalOperator,
        mainQb: SelectQueryBuilder<T>,
        entity: Type<T>,
    ) {
        if (condition.isExistsCondition) {
            // Generate EXISTS subquery for duplicate custom property conditions
            const existsClause = this.buildExistsSubquery(condition, mainQb, entity);
            if (existsClause) {
                if (operator === LogicalOperator.AND) {
                    qb.andWhere(existsClause.clause, existsClause.parameters);
                } else {
                    qb.orWhere(existsClause.clause, existsClause.parameters);
                }
                return;
            }
        }

        // Standard WHERE clause handling
        if (operator === LogicalOperator.AND) {
            qb.andWhere(condition.clause, condition.parameters);
        } else {
            qb.orWhere(condition.clause, condition.parameters);
        }
    }

    /**
     * Builds an EXISTS subquery for a custom property condition on a *-to-Many relation.
     * This is necessary because a simple WHERE clause on a joined table cannot express
     * "entity has related item with value A AND entity has related item with value B"
     * when those are in separate rows of the related table.
     *
     * Supports both:
     * - ManyToMany relations (uses junction table)
     * - OneToMany relations (direct foreign key on the related table)
     *
     * @see https://github.com/vendurehq/vendure/issues/3267
     */
    private buildExistsSubquery<T extends VendureEntity>(
        condition: WhereCondition,
        mainQb: SelectQueryBuilder<T>,
        entity: Type<T>,
    ): { clause: string; parameters: Record<string, any> } | null {
        if (!condition.isExistsCondition) {
            return null;
        }

        const { customPropertyPath } = condition.isExistsCondition;
        const pathParts = customPropertyPath.split('.');

        if (pathParts.length < 2) {
            return null;
        }

        const relationName = pathParts[0]; // e.g., 'facetValues' or 'orderLines'
        const columnName = pathParts[1]; // e.g., 'id'

        const metadata = mainQb.expressionMap.mainAlias?.metadata;
        if (!metadata) {
            return null;
        }

        const relation = metadata.findRelationWithPropertyPath(relationName);
        if (!relation) {
            return null;
        }

        // Get the related entity's table and column info
        const inverseEntityMeta = relation.inverseEntityMetadata;
        const inverseTableName = inverseEntityMeta.tablePath;

        // Generate unique alias using counter
        existsSubqueryCounter++;
        const aliasBase = `lqb_exists_${existsSubqueryCounter}`;

        // Determine the comparison operator from the original clause
        const comparisonOperator = this.extractComparisonOperator(condition.clause);

        // Copy all parameters with 'exists_' prefix to ensure uniqueness.
        // This handles operators with multiple params like BETWEEN (arg1_a, arg1_b).
        const parameters: Record<string, any> = {};
        const paramKeys = Object.keys(condition.parameters);
        for (const key of paramKeys) {
            parameters[`exists_${key}`] = condition.parameters[key];
        }
        // Use the first param key as the base for the WHERE clause construction.
        // For BETWEEN this will be 'exists_arg1' (we strip the _a/_b suffix).
        const baseParamKey = paramKeys[0]?.replace(/_[ab]$/, '') ?? 'arg';
        const newParamKey = `exists_${baseParamKey}`;

        // Helper to escape identifiers for the current database driver (handles PostgreSQL quoting)
        const escapeId = (name: string) => mainQb.connection.driver.escape(name);
        const escapeTablePath = (path: string) =>
            path.split('.').map(segment => mainQb.connection.driver.escape(segment)).join('.');

        let existsQuery: string;

        if (relation.isManyToMany) {
            // ManyToMany: Uses a junction table
            const junctionMeta = relation.junctionEntityMetadata;
            if (!junctionMeta) {
                return null;
            }

            const junctionTableName = junctionMeta.tablePath;
            const ownerColumn = junctionMeta.ownerColumns[0];
            const inverseColumn = junctionMeta.inverseColumns[0];

            if (!ownerColumn || !inverseColumn) {
                return null;
            }

            const junctionAlias = aliasBase;
            const relatedAlias = `${aliasBase}_related`;
            const whereCondition = this.buildWhereConditionClause(
                relatedAlias,
                columnName,
                comparisonOperator,
                newParamKey,
                escapeId,
            );

            // EXISTS (SELECT 1 FROM junction_table jt
            //         INNER JOIN related_table rt ON jt.inverseColumn = rt.id
            //         WHERE jt.ownerColumn = main_entity.id AND rt.columnName = :paramValue)
            existsQuery = `EXISTS (
                SELECT 1 FROM ${escapeTablePath(junctionTableName)} ${escapeId(junctionAlias)}
                INNER JOIN ${escapeTablePath(inverseTableName)} ${escapeId(relatedAlias)}
                    ON ${escapeId(junctionAlias)}.${escapeId(inverseColumn.databaseName)} = ${escapeId(relatedAlias)}.${escapeId('id')}
                    WHERE ${escapeId(junctionAlias)}.${escapeId(ownerColumn.databaseName)} = ${escapeId(mainQb.alias)}.${escapeId('id')} AND ${whereCondition}
            )`;
        } else if (relation.isOneToMany) {
            // OneToMany: The related table has a foreign key back to the main entity
            const relatedAlias = aliasBase;

            // Find the foreign key column on the related entity that points back to the main entity
            const inverseRelation = relation.inverseRelation;
            if (!inverseRelation) {
                return null;
            }

            // Get the join columns from the inverse relation (ManyToOne side)
            const joinColumns = inverseRelation.joinColumns;
            if (!joinColumns || joinColumns.length === 0) {
                return null;
            }

            const foreignKeyColumn = joinColumns[0].databaseName;
            if (!foreignKeyColumn) {
                return null;
            }

            const whereCondition = this.buildWhereConditionClause(
                relatedAlias,
                columnName,
                comparisonOperator,
                newParamKey,
                escapeId,
            );

            // EXISTS (SELECT 1 FROM related_table rt
            //         WHERE rt.foreignKey = main_entity.id AND rt.columnName = :paramValue)
            existsQuery = `EXISTS (
                SELECT 1 FROM ${escapeTablePath(inverseTableName)} ${escapeId(relatedAlias)}
                WHERE ${escapeId(relatedAlias)}.${escapeId(foreignKeyColumn)} = ${escapeId(mainQb.alias)}.${escapeId('id')} AND ${whereCondition}
            )`;
        } else {
            // Not a *-to-Many relation, shouldn't happen but fall back gracefully
            return null;
        }

        return {
            clause: existsQuery,
            parameters,
        };
    }

    /**
     * Extracts the comparison operator from a SQL clause string.
     */
    private extractComparisonOperator(clause: string): string {
        if (clause.includes('!=')) {
            return '!=';
        } else if (clause.includes('>=')) {
            return '>=';
        } else if (clause.includes('<=')) {
            return '<=';
        } else if (clause.includes('>')) {
            return '>';
        } else if (clause.includes('<')) {
            return '<';
        } else if (clause.includes(' IN ')) {
            return 'IN';
        } else if (clause.includes(' NOT IN ')) {
            return 'NOT IN';
        } else if (clause.includes(' ILIKE ')) {
            return 'ILIKE';
        } else if (clause.includes(' NOT LIKE ') || clause.includes(' NOT ILIKE ')) {
            return clause.includes('ILIKE') ? 'NOT ILIKE' : 'NOT LIKE';
        } else if (clause.includes(' LIKE ')) {
            return 'LIKE';
        } else if (clause.includes(' IS NULL')) {
            return 'IS NULL';
        } else if (clause.includes(' IS NOT NULL')) {
            return 'IS NOT NULL';
        } else if (clause.includes(' BETWEEN ')) {
            return 'BETWEEN';
        }
        return '=';
    }

    /**
     * Builds a WHERE condition clause string for the EXISTS subquery.
     */
    private buildWhereConditionClause(
        alias: string,
        columnName: string,
        operator: string,
        paramKey: string,
        escapeId: (name: string) => string,
    ): string {
        const col = `${escapeId(alias)}.${escapeId(columnName)}`;
        if (operator === 'IN') {
            return `${col} IN (:...${paramKey})`;
        } else if (operator === 'NOT IN') {
            return `${col} NOT IN (:...${paramKey})`;
        } else if (operator === 'IS NULL') {
            return `${col} IS NULL`;
        } else if (operator === 'IS NOT NULL') {
            return `${col} IS NOT NULL`;
        } else if (operator === 'BETWEEN') {
            return `${col} BETWEEN :${paramKey}_a AND :${paramKey}_b`;
        }
        return `${col} ${operator} :${paramKey}`;
    }

    private parseTakeSkipParams(
        apiType: ApiType,
        options: ListQueryOptions<any>,
        ignoreQueryLimits = false,
    ): { take: number; skip: number } {
        const { shopListQueryLimit, adminListQueryLimit } = this.configService.apiOptions;
        const takeLimit = ignoreQueryLimits
            ? Number.MAX_SAFE_INTEGER
            : apiType === 'admin'
              ? adminListQueryLimit
              : shopListQueryLimit;
        if (options.take && options.take > takeLimit) {
            throw new UserInputError('error.list-query-limit-exceeded', { limit: takeLimit });
        }
        const rawConnection = this.connection.rawConnection;
        const skip = Math.max(options.skip ?? 0, 0);
        // `take` must not be negative, and must not be greater than takeLimit
        let take = options.take == null ? takeLimit : Math.min(Math.max(options.take, 0), takeLimit);
        if (options.skip !== undefined && options.take === undefined) {
            take = takeLimit;
        }
        return { take, skip };
    }

    /**
     * @description
     * As part of list optimization, we only join the minimum required relations which are needed to
     * get the base list query. Other relations are then joined individually in the patched `getManyAndCount()`
     * method.
     */
    private getMinimumRequiredRelations<T extends VendureEntity>(
        repository: Repository<T>,
        options: ListQueryOptions<T>,
        extendedOptions: ExtendedListQueryOptions<T>,
    ): string[] {
        const requiredRelations: string[] = [];
        if (extendedOptions.channelId) {
            requiredRelations.push('channels');
        }

        if (extendedOptions.customPropertyMap) {
            const metadata = repository.metadata;

            for (const [property, path] of Object.entries(extendedOptions.customPropertyMap)) {
                if (!this.customPropertyIsBeingUsed(property, options)) {
                    // If the custom property is not being used to filter or sort, then we don't need
                    // to join the associated relations.
                    continue;
                }
                const relationPath = path.split('.').slice(0, -1);
                let targetMetadata = metadata;
                const reconstructedPath = [];
                for (const relationPathPart of relationPath) {
                    const relationMetadata = targetMetadata.findRelationWithPropertyPath(relationPathPart);
                    if (relationMetadata) {
                        reconstructedPath.push(relationMetadata.propertyName);
                        requiredRelations.push(reconstructedPath.join('.'));
                        targetMetadata = relationMetadata.inverseEntityMetadata;
                    }
                }
            }
        }
        return unique(requiredRelations);
    }

    private customPropertyIsBeingUsed(property: string, options: ListQueryOptions<any>): boolean {
        return !!(options.sort?.[property] || this.isPropertyUsedInFilter(property, options.filter));
    }

    private isPropertyUsedInFilter(
        property: string,
        filter?: NullOptionals<FilterParameter<any>> | null,
    ): boolean {
        return !!(
            filter &&
            (filter[property] ||
                filter._and?.some(nestedFilter => this.isPropertyUsedInFilter(property, nestedFilter)) ||
                filter._or?.some(nestedFilter => this.isPropertyUsedInFilter(property, nestedFilter)))
        );
    }

    /**
     * If a customPropertyMap is provided, we need to take the path provided and convert it to the actual
     * relation aliases being used by the SelectQueryBuilder.
     *
     * This method mutates the customPropertyMap object.
     */
    private normalizeCustomPropertyMap<T extends VendureEntity>(
        customPropertyMap: { [name: string]: string },
        options: ListQueryOptions<any>,
        qb: SelectQueryBuilder<any>,
    ) {
        for (const [property, value] of Object.entries(customPropertyMap)) {
            if (!this.customPropertyIsBeingUsed(property, options)) {
                continue;
            }
            let parts = customPropertyMap[property].split('.');
            const normalizedRelationPath: string[] = [];
            let entityMetadata = qb.expressionMap.mainAlias?.metadata;
            let entityAlias = qb.alias;
            while (parts.length > 1) {
                const entityPart = 2 <= parts.length ? parts[0] : qb.alias;
                const columnPart = parts[parts.length - 1];

                if (!entityMetadata) {
                    Logger.error(`Could not get metadata for entity ${qb.alias}`);
                    continue;
                }
                const relationMetadata = entityMetadata.findRelationWithPropertyPath(entityPart);
                if (!relationMetadata || !relationMetadata?.propertyName) {
                    Logger.error(
                        `The customPropertyMap entry "${property}:${value}" could not be resolved to a related table`,
                    );
                    delete customPropertyMap[property];
                    return;
                }
                const alias = `${entityMetadata.tableName}_${relationMetadata.propertyName}`;
                if (!this.isRelationAlreadyJoined(qb, alias)) {
                    qb.leftJoinAndSelect(`${entityAlias}.${relationMetadata.propertyName}`, alias);
                }
                parts = parts.slice(1);
                entityMetadata = relationMetadata?.inverseEntityMetadata;
                normalizedRelationPath.push(entityAlias);

                if (parts.length === 1) {
                    normalizedRelationPath.push(alias, columnPart);
                } else {
                    entityAlias = alias;
                }
            }
            customPropertyMap[property] = normalizedRelationPath.slice(-2).join('.');
        }
    }

    /**
     * Some calculated columns (those with the `@Calculated()` decorator) require extra joins in order
     * to derive the data needed for their expressions.
     */
    private joinCalculatedColumnRelations<T extends VendureEntity>(
        qb: SelectQueryBuilder<T>,
        entity: Type<T>,
        options: ListQueryOptions<T>,
    ) {
        const calculatedColumns = getCalculatedColumns(entity);
        const filterAndSortFields = this.getFilterAndSortFields(options);
        const alias = getEntityAlias(this.connection.rawConnection, entity);
        for (const field of filterAndSortFields) {
            const calculatedColumnDef = calculatedColumns.find(c => c.name === field);
            const instruction = calculatedColumnDef?.listQuery;
            if (instruction) {
                const relations = instruction.relations || [];
                for (const relation of relations) {
                    const relationIsAlreadyJoined = qb.expressionMap.joinAttributes.find(
                        ja => ja.entityOrProperty === `${alias}.${relation}`,
                    );
                    if (!relationIsAlreadyJoined) {
                        const propertyPath = relation.includes('.') ? relation : `${alias}.${relation}`;
                        const relationAlias = relation.includes('.')
                            ? relation.split('.').reverse()[0]
                            : relation;
                        qb.innerJoinAndSelect(propertyPath, relationAlias);
                    }
                }
                if (typeof instruction.query === 'function') {
                    instruction.query(qb);
                }
            }
        }
    }

    private getFilterAndSortFields<T extends VendureEntity>(options: ListQueryOptions<T>): string[] {
        const sortFields = Object.keys(options.sort || {});
        // filter fields can be immediate children of the filter object
        // or nested inside _and or _or
        const filterFields = this.getFilterFields(options.filter);
        return unique([...sortFields, ...filterFields]);
    }

    private getFilterFields<T extends VendureEntity>(
        filter?: NullOptionals<FilterParameter<T>> | null,
    ): string[] {
        if (!filter) {
            return [];
        }
        const filterFields: string[] = [];
        for (const key in filter) {
            if (key === '_and' || key === '_or') {
                const value = filter[key] as Array<FilterParameter<T>>;
                for (const condition of value) {
                    filterFields.push(...this.getFilterFields(condition));
                }
            } else if (filter[key as keyof FilterParameter<T>]) {
                filterFields.push(key);
            }
        }
        return unique(filterFields);
    }

    /**
     * @description
     * If this entity is Translatable, and we are sorting on one of the translatable fields,
     * then we need to apply appropriate WHERE clauses to limit
     * the joined translation relations.
     */
    private applyTranslationConditions<T extends VendureEntity>(
        qb: SelectQueryBuilder<any>,
        entity: Type<T>,
        sortParams: NullOptionals<SortParameter<T>> & FindOneOptions<T>['order'],
        ctx?: RequestContext,
    ) {
        const languageCode = ctx?.languageCode || this.configService.defaultLanguageCode;

        const { translationColumns } = getColumnMetadata(qb.connection, entity);
        const alias = qb.alias;

        const sortKeys = Object.keys(sortParams);
        let sortingOnTranslatableKey = false;
        for (const translationColumn of translationColumns) {
            if (sortKeys.includes(translationColumn.propertyName)) {
                sortingOnTranslatableKey = true;
            }
        }

        if (translationColumns.length && sortingOnTranslatableKey) {
            const translationsAlias = qb.connection.namingStrategy.joinTableName(
                alias,
                'translations',
                '',
                '',
            );
            if (!this.isRelationAlreadyJoined(qb, translationsAlias)) {
                qb.leftJoinAndSelect(`${alias}.translations`, translationsAlias);
            }

            qb.andWhere(
                new Brackets(qb1 => {
                    qb1.where(`${translationsAlias}.languageCode = :languageCode`, { languageCode });
                    const defaultLanguageCode =
                        ctx?.channel.defaultLanguageCode ?? this.configService.defaultLanguageCode;
                    const translationEntity = translationColumns[0].entityMetadata.target;
                    if (languageCode !== defaultLanguageCode) {
                        // If the current languageCode is not the default, then we create a more
                        // complex WHERE clause to allow us to use the non-default translations and
                        // fall back to the default language if no translation exists.
                        qb1.orWhere(
                            new Brackets(qb2 => {
                                const subQb1 = this.connection.rawConnection
                                    .createQueryBuilder(translationEntity, 'translation')
                                    .where(`translation.base = ${alias}.id`)
                                    .andWhere('translation.languageCode = :defaultLanguageCode');
                                const subQb2 = this.connection.rawConnection
                                    .createQueryBuilder(translationEntity, 'translation')
                                    .where(`translation.base = ${alias}.id`)
                                    .andWhere('translation.languageCode = :nonDefaultLanguageCode');

                                qb2.where(`EXISTS (${subQb1.getQuery()})`).andWhere(
                                    `NOT EXISTS (${subQb2.getQuery()})`,
                                );
                            }),
                        );
                    } else {
                        qb1.orWhere(
                            new Brackets(qb2 => {
                                const subQb1 = this.connection.rawConnection
                                    .createQueryBuilder(translationEntity, 'translation')
                                    .where(`translation.base = ${alias}.id`)
                                    .andWhere('translation.languageCode = :defaultLanguageCode');
                                const subQb2 = this.connection.rawConnection
                                    .createQueryBuilder(translationEntity, 'translation')
                                    .where(`translation.base = ${alias}.id`)
                                    .andWhere('translation.languageCode != :defaultLanguageCode');

                                qb2.where(`NOT EXISTS (${subQb1.getQuery()})`).andWhere(
                                    `EXISTS (${subQb2.getQuery()})`,
                                );
                            }),
                        );
                    }
                    qb.setParameters({
                        nonDefaultLanguageCode: languageCode,
                        defaultLanguageCode,
                    });
                }),
            );
        }
    }

    /**
     * Registers a user-defined function (for flavors of SQLite driver that support it)
     * so that we can run regex filters on string fields.
     */
    private registerSQLiteRegexpFunction() {
        const regexpFn = (pattern: string, value: string) => {
            const result = new RegExp(`${pattern}`, 'i').test(value);
            return result ? 1 : 0;
        };
        const dbType = this.connection.rawConnection.options.type;
        if (dbType === 'better-sqlite3') {
            const driver = this.connection.rawConnection.driver as BetterSqlite3Driver;
            driver.databaseConnection.function('regexp', regexpFn);
        }
        if (dbType === 'sqljs') {
            const driver = this.connection.rawConnection.driver as SqljsDriver;
            driver.databaseConnection.create_function('regexp', regexpFn);
        }
    }

    private isRelationAlreadyJoined<T extends VendureEntity>(
        qb: SelectQueryBuilder<T>,
        alias: string,
    ): boolean {
        return qb.expressionMap.joinAttributes.some(ja => ja.alias.name === alias);
    }
}
