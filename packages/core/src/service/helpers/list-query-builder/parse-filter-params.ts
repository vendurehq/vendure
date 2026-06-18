import { LogicalOperator } from '@vendure/common/lib/generated-types';
import { Type } from '@vendure/common/lib/shared-types';
import { assertNever } from '@vendure/common/lib/shared-utils';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DateUtils } from 'typeorm/util/DateUtils';

import { InternalServerError, UserInputError } from '../../../common/error/errors';
import {
    BooleanOperators,
    DateOperators,
    FilterParameter,
    ListOperators,
    NullOptionals,
    NumberOperators,
    StringOperators,
} from '../../../common/types/common-types';
import { VendureEntity } from '../../../entity/base/base.entity';

import { escapeCalculatedColumnExpression, getColumnMetadata } from './connection-utils';
import { getCalculatedColumns } from './get-calculated-columns';

export interface WhereGroup {
    operator: LogicalOperator;
    conditions: Array<WhereCondition | WhereGroup>;
}

export interface WhereCondition {
    clause: string;
    parameters: { [param: string]: string | number | string[] };
    /**
     * When defined, this condition should be converted to an EXISTS subquery
     * instead of a simple WHERE clause. This is used for custom property fields
     * that map to *-to-Many relations (OneToMany or ManyToMany), where standard
     * JOIN + WHERE semantics cannot correctly express AND logic across multiple
     * related rows.
     *
     * @see https://github.com/vendurehq/vendure/issues/3267
     */
    isExistsCondition?: {
        /**
         * The custom property key from the customPropertyMap
         */
        customPropertyKey: string;
        /**
         * The original path from customPropertyMap (e.g., 'facetValues.id')
         */
        customPropertyPath: string;
    };
}

type AllOperators = StringOperators & BooleanOperators & NumberOperators & DateOperators & ListOperators;
type Operator = { [K in keyof AllOperators]-?: K }[keyof AllOperators];

/**
 * @description
 * Options for the parseFilterParams function.
 */
export interface ParseFilterParamsOptions<T extends VendureEntity> {
    /**
     * The TypeORM DataSource connection.
     */
    connection: DataSource;
    /**
     * The entity type being queried.
     */
    entity: Type<T>;
    /**
     * The filter parameters from the GraphQL query.
     */
    filterParams?: NullOptionals<FilterParameter<T>> | null;
    /**
     * Map of custom property names to their relation paths (after normalization).
     * Note: This map gets mutated by the ListQueryBuilder's normalizeCustomPropertyMap method.
     */
    customPropertyMap?: { [name: string]: string };
    /**
     * Original custom property map before normalization, containing the original relation paths.
     * This is needed to detect *-to-Many relations and to generate EXISTS subqueries with
     * the correct table/column references.
     */
    originalCustomPropertyMap?: { [name: string]: string };
    /**
     * The alias used for the main entity in the query.
     */
    entityAlias?: string;
}

/**
 * @description
 * Parses filter parameters from a GraphQL query and converts them into SQL WHERE conditions.
 *
 * For custom property fields that map to *-to-Many relations, all conditions will be marked
 * for EXISTS subquery treatment to ensure correct AND semantics when filtering across
 * multiple related rows.
 */
export function parseFilterParams<T extends VendureEntity>(
    options: ParseFilterParamsOptions<T>,
): Array<WhereCondition | WhereGroup> {
    const { connection, entity, filterParams, customPropertyMap, originalCustomPropertyMap, entityAlias } =
        options;

    if (!filterParams) {
        return [];
    }
    const { columns, translationColumns, alias: defaultAlias } = getColumnMetadata(connection, entity);
    const alias = entityAlias ?? defaultAlias;
    const calculatedColumns = getCalculatedColumns(entity);

    const dbType = connection.options.type;
    let argIndex = 1;

    // Detect which custom property fields map to *-to-Many relations.
    // All filter conditions on these fields will use EXISTS subqueries for correct AND semantics.
    const toManyRelationCustomProperties = getToManyRelationCustomProperties(
        connection,
        entity,
        originalCustomPropertyMap,
        filterParams,
    );

    function buildConditionsForField(key: string, operation: FilterParameter<T>): WhereCondition[] {
        const output: WhereCondition[] = [];
        const calculatedColumnDef = calculatedColumns.find(c => c.name === key);
        const instruction = calculatedColumnDef?.listQuery;
        const calculatedColumnExpression = instruction?.expression;

        // Mark ALL conditions on *-to-Many relation custom properties for EXISTS subquery treatment.
        // This ensures correct AND semantics regardless of how many times the field is used.
        const isToManyCustomProperty =
            toManyRelationCustomProperties.has(key) && originalCustomPropertyMap?.[key];

        for (const [operator, operand] of Object.entries(operation as object)) {
            let fieldName: string;
            if (columns.find(c => c.propertyName === key)) {
                fieldName = `${alias}.${key}`;
            } else if (translationColumns.find(c => c.propertyName === key)) {
                const translationsAlias = [alias, 'translations'].join('__');
                fieldName = `${translationsAlias}.${key}`;
            } else if (calculatedColumnExpression) {
                fieldName = escapeCalculatedColumnExpression(connection, calculatedColumnExpression);
            } else if (customPropertyMap?.[key]) {
                fieldName = customPropertyMap[key];
            } else {
                throw new UserInputError('error.invalid-filter-field');
            }
            const condition = buildWhereCondition(fieldName, operator as Operator, operand, argIndex, dbType);

            // Mark *-to-Many custom property fields for EXISTS subquery treatment
            if (isToManyCustomProperty) {
                condition.isExistsCondition = {
                    customPropertyKey: key,
                    customPropertyPath: originalCustomPropertyMap[key],
                };
            }

            output.push(condition);
            argIndex++;
        }
        return output;
    }

    function processFilterParameter(param: FilterParameter<T>): Array<WhereCondition | WhereGroup> {
        const result: Array<WhereCondition | WhereGroup> = [];
        for (const [key, operation] of Object.entries(param)) {
            if (key === '_and' || key === '_or') {
                const isAndOperator = key === '_and';
                result.push({
                    operator: isAndOperator ? LogicalOperator.AND : LogicalOperator.OR,
                    conditions: operation.map(o => processFilterParameter(o)).flat(),
                });
            } else if (operation && !Array.isArray(operation)) {
                result.push(...buildConditionsForField(key, operation));
            }
        }
        return result;
    }

    return processFilterParameter(filterParams as FilterParameter<T>);
}

/**
 * @description
 * Identifies which custom property keys map to *-to-Many relations (OneToMany or ManyToMany).
 * These fields require EXISTS subqueries for correct AND semantics when filtering across
 * multiple related rows.
 *
 * @see https://github.com/vendurehq/vendure/issues/3267
 */
function getToManyRelationCustomProperties<T extends VendureEntity>(
    connection: DataSource,
    entity: Type<T>,
    originalCustomPropertyMap: { [name: string]: string } | undefined,
    filterParams: NullOptionals<FilterParameter<T>>,
): Set<string> {
    const toManyProperties = new Set<string>();
    if (!originalCustomPropertyMap) {
        return toManyProperties;
    }

    const metadata = connection.getMetadata(entity);

    for (const [property, path] of Object.entries(originalCustomPropertyMap)) {
        // Only check properties that are actually being used in filters
        if (!isPropertyUsedInFilter(property, filterParams as NullOptionals<FilterParameter<any>>)) {
            continue;
        }

        // Parse the path to get the relation name (e.g., 'facetValues.id' -> 'facetValues')
        const pathParts = path.split('.');
        if (pathParts.length < 2) {
            continue;
        }

        const relationName = pathParts[0];
        const relationMetadata = metadata.findRelationWithPropertyPath(relationName);

        if (relationMetadata && (relationMetadata.isOneToMany || relationMetadata.isManyToMany)) {
            toManyProperties.add(property);
        }
    }

    return toManyProperties;
}

/**
 * Checks if a property is used anywhere in the filter parameters,
 * including nested _and/_or blocks.
 */
function isPropertyUsedInFilter(
    property: string,
    filter: NullOptionals<FilterParameter<any>> | null | undefined,
): boolean {
    if (!filter) {
        return false;
    }
    if (filter[property]) {
        return true;
    }
    if (filter._and) {
        for (const nestedFilter of filter._and) {
            if (isPropertyUsedInFilter(property, nestedFilter)) {
                return true;
            }
        }
    }
    if (filter._or) {
        for (const nestedFilter of filter._or) {
            if (isPropertyUsedInFilter(property, nestedFilter)) {
                return true;
            }
        }
    }
    return false;
}

function buildWhereCondition(
    fieldName: string,
    operator: Operator,
    operand: any,
    argIndex: number,
    dbType: DataSourceOptions['type'],
): WhereCondition {
    switch (operator) {
        case 'eq':
            return {
                clause: `${fieldName} = :arg${argIndex}`,
                parameters: { [`arg${argIndex}`]: convertDate(operand) },
            };
        case 'notEq':
            return {
                clause: `${fieldName} != :arg${argIndex}`,
                parameters: { [`arg${argIndex}`]: convertDate(operand) },
            };
        case 'inList':
        case 'contains': {
            const LIKE = dbType === 'postgres' ? 'ILIKE' : 'LIKE';
            return {
                clause: `${fieldName} ${LIKE} :arg${argIndex}`,
                parameters: {
                    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                    [`arg${argIndex}`]: `%${typeof operand === 'string' ? operand.trim() : operand}%`,
                },
            };
        }
        case 'notContains': {
            const LIKE = dbType === 'postgres' ? 'ILIKE' : 'LIKE';
            return {
                clause: `${fieldName} NOT ${LIKE} :arg${argIndex}`,
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                parameters: { [`arg${argIndex}`]: `%${operand.trim()}%` },
            };
        }
        case 'in': {
            if (Array.isArray(operand) && operand.length) {
                return {
                    clause: `${fieldName} IN (:...arg${argIndex})`,
                    parameters: { [`arg${argIndex}`]: operand },
                };
            } else {
                // "in" with an empty set should always return nothing
                return {
                    clause: '1 = 0',
                    parameters: {},
                };
            }
        }
        case 'notIn': {
            if (Array.isArray(operand) && operand.length) {
                return {
                    clause: `${fieldName} NOT IN (:...arg${argIndex})`,
                    parameters: { [`arg${argIndex}`]: operand },
                };
            } else {
                // "notIn" with an empty set should always return all
                return {
                    clause: '1 = 1',
                    parameters: {},
                };
            }
        }
        case 'regex':
            return {
                clause: getRegexpClause(fieldName, argIndex, dbType),
                parameters: { [`arg${argIndex}`]: operand },
            };
        case 'lt':
        case 'before':
            return {
                clause: `${fieldName} < :arg${argIndex}`,
                parameters: { [`arg${argIndex}`]: convertDate(operand) },
            };
        case 'gt':
        case 'after':
            return {
                clause: `${fieldName} > :arg${argIndex}`,
                parameters: { [`arg${argIndex}`]: convertDate(operand) },
            };
        case 'lte':
            return {
                clause: `${fieldName} <= :arg${argIndex}`,
                parameters: { [`arg${argIndex}`]: operand },
            };
        case 'gte':
            return {
                clause: `${fieldName} >= :arg${argIndex}`,
                parameters: { [`arg${argIndex}`]: operand },
            };
        case 'between':
            return {
                clause: `${fieldName} BETWEEN :arg${argIndex}_a AND :arg${argIndex}_b`,
                parameters: {
                    [`arg${argIndex}_a`]: convertDate(operand.start),
                    [`arg${argIndex}_b`]: convertDate(operand.end),
                },
            };
        case 'isNull':
            return {
                clause: operand === true ? `${fieldName} IS NULL` : `${fieldName} IS NOT NULL`,
                parameters: {},
            };
        default:
            assertNever(operator);
    }
    return {
        clause: '1',
        parameters: {},
    };
}

/**
 * Converts a JS Date object to a string format recognized by all DB engines.
 * See https://github.com/vendurehq/vendure/issues/251
 */
function convertDate(input: Date | string | number): string | number {
    if (input instanceof Date) {
        return DateUtils.mixedDateToUtcDatetimeString(input);
    }
    return input;
}

/**
 * Returns a valid regexp clause based on the current DB driver type.
 */
function getRegexpClause(fieldName: string, argIndex: number, dbType: DataSourceOptions['type']): string {
    switch (dbType) {
        case 'mariadb':
        case 'mysql':
        case 'sqljs':
        case 'better-sqlite3':
        case 'aurora-mysql':
            return `${fieldName} REGEXP :arg${argIndex}`;
        case 'postgres':
        case 'aurora-postgres':
        case 'cockroachdb':
            return `${fieldName} ~* :arg${argIndex}`;
        // The node-sqlite3 driver does not support user-defined functions
        // and therefore we are unable to define a custom regexp
        // function. See https://github.com/mapbox/node-sqlite3/issues/140
        case 'sqlite':
        default:
            throw new InternalServerError(
                `The 'regex' filter is not available when using the '${dbType}' driver`,
            );
    }
}
