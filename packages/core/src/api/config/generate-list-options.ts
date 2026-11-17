import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import {
    buildSchema,
    GraphQLEnumType,
    GraphQLField,
    GraphQLInputField,
    GraphQLInputFieldConfig,
    GraphQLInputFieldConfigMap,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLInt,
    GraphQLList,
    GraphQLNamedType,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLSchema,
    isEnumType,
    isInputObjectType,
    isListType,
    isNonNullType,
    isObjectType,
} from 'graphql/index.js';

import { mergeTypesIntoSchema } from './merge-types-into-schema';

/**
 * Generates ListOptions inputs for queries which return PaginatedList types.
 */
export function generateListOptions(typeDefsOrSchema: string | GraphQLSchema): GraphQLSchema {
    const schema = typeof typeDefsOrSchema === 'string' ? buildSchema(typeDefsOrSchema) : typeDefsOrSchema;
    const queryType = schema.getQueryType();
    if (!queryType) {
        return schema;
    }
    const logicalOperatorEnum = schema.getType('LogicalOperator');
    const objectTypes = Object.values(schema.getTypeMap()).filter(isObjectType);
    const allFields = objectTypes.reduce(
        (fields, type) => {
            const typeFields = Object.values(type.getFields()).filter(f => isListQueryType(f.type));
            return [...fields, ...typeFields];
        },
        [] as Array<GraphQLField<any, any>>,
    );
    const generatedTypes: GraphQLNamedType[] = [];

    for (const query of allFields) {
        const targetTypeName = unwrapNonNullType(query.type).toString().replace(/List$/, '');
        const targetType = schema.getType(targetTypeName);
        if (targetType && isObjectType(targetType)) {
            const sortParameter = createSortParameter(schema, targetType);
            const filterParameter = createFilterParameter(schema, targetType);
            const existingListOptions = schema.getType(
                `${targetTypeName}ListOptions`,
            ) as GraphQLInputObjectType | null;
            const generatedListOptions = new GraphQLInputObjectType({
                name: `${targetTypeName}ListOptions`,
                fields: withExistingFieldsFirst(
                    {
                        skip: {
                            type: GraphQLInt,
                            description: 'Skips the first n results, for use in pagination',
                        },
                        take: { type: GraphQLInt, description: 'Takes n results, for use in pagination' },
                        sort: {
                            type: sortParameter,
                            description: 'Specifies which properties to sort the results by',
                        },
                        filter: { type: filterParameter, description: 'Allows the results to be filtered' },
                        ...(logicalOperatorEnum
                            ? {
                                  filterOperator: {
                                      type: logicalOperatorEnum as GraphQLEnumType,
                                      description:
                                          'Specifies whether multiple top-level "filter" fields should be combined ' +
                                          'with a logical AND or OR operation. Defaults to AND.',
                                  },
                              }
                            : {}),
                        ...(existingListOptions ? existingListOptions.getFields() : {}),
                    },
                    existingListOptions,
                ),
            });

            if (!query.args.find(a => a.type.toString() === `${targetTypeName}ListOptions`)) {
                query.args = [
                    ...query.args,
                    {
                        name: 'options',
                        type: generatedListOptions,
                        description: null,
                        defaultValue: null,
                        extensions: {},
                        astNode: null,
                        deprecationReason: null,
                    },
                ];
            }

            generatedTypes.push(filterParameter);
            generatedTypes.push(sortParameter);
            generatedTypes.push(generatedListOptions);
        }
    }
    return mergeTypesIntoSchema(schema, generatedTypes);
}

/**
 * Orders the given field config map so that fields declared on a pre-existing
 * input type come first, in their declared order. Merged types were historically
 * emitted in this order, and consumers such as codegen diff against it.
 */
function withExistingFieldsFirst(
    fieldsConfig: GraphQLInputFieldConfigMap,
    existingInput: GraphQLNamedType | null | undefined,
): GraphQLInputFieldConfigMap {
    if (!existingInput || !isInputObjectType(existingInput)) {
        return fieldsConfig;
    }
    const ordered: GraphQLInputFieldConfigMap = {};
    for (const name of Object.keys(existingInput.getFields())) {
        if (fieldsConfig[name]) {
            ordered[name] = fieldsConfig[name];
        }
    }
    for (const [name, config] of Object.entries(fieldsConfig)) {
        if (!ordered[name]) {
            ordered[name] = config;
        }
    }
    return ordered;
}

function isListQueryType(type: GraphQLOutputType): type is GraphQLObjectType {
    const innerType = unwrapNonNullType(type);
    return isObjectType(innerType) && !!innerType.getInterfaces().find(i => i.name === 'PaginatedList');
}

function createSortParameter(schema: GraphQLSchema, targetType: GraphQLObjectType) {
    const fields: Array<GraphQLField<any, any> | GraphQLInputField> = Object.values(targetType.getFields());
    const targetTypeName = targetType.name;
    const SortOrder = schema.getType('SortOrder') as GraphQLEnumType;

    const inputName = `${targetTypeName}SortParameter`;
    const existingInput = schema.getType(inputName);
    if (isInputObjectType(existingInput)) {
        fields.push(...Object.values(existingInput.getFields()));
    }

    const sortableTypes = ['ID', 'String', 'Int', 'Float', 'DateTime', 'Money'];
    const fieldConfigMap = fields
        .map(field => {
            if (unwrapNonNullType(field.type) === SortOrder) {
                return field;
            } else {
                const innerType = unwrapNonNullType(field.type);
                if (isListType(innerType)) {
                    return;
                }
                return sortableTypes.includes(innerType.name) ? field : undefined;
            }
        })
        .filter(notNullOrUndefined)
        .reduce((result, field) => {
            const fieldConfig: GraphQLInputFieldConfig = {
                type: SortOrder,
                description: field.description,
            };
            return {
                ...result,
                [field.name]: fieldConfig,
            };
        }, {} as GraphQLInputFieldConfigMap);
    return new GraphQLInputObjectType({
        name: inputName,
        fields: withExistingFieldsFirst(fieldConfigMap, existingInput),
    });
}

function createFilterParameter(schema: GraphQLSchema, targetType: GraphQLObjectType): GraphQLInputObjectType {
    const fields: Array<GraphQLField<any, any> | GraphQLInputField> = Object.values(targetType.getFields());
    const targetTypeName = targetType.name;
    const { StringOperators, BooleanOperators, NumberOperators, DateOperators, IDOperators } =
        getCommonTypes(schema);

    const inputName = `${targetTypeName}FilterParameter`;
    const existingInput = schema.getType(inputName);
    if (isInputObjectType(existingInput)) {
        fields.push(...Object.values(existingInput.getFields()));
    }

    function getFilterType(field: GraphQLField<any, any> | GraphQLInputField): GraphQLInputType | undefined {
        const innerType = unwrapNonNullType(field.type);
        if (isListType(innerType)) {
            return;
        }
        if (isEnumType(innerType)) {
            return StringOperators;
        }
        switch (innerType.name) {
            case 'String':
                return StringOperators;
            case 'Boolean':
                return BooleanOperators;
            case 'Int':
            case 'Float':
            case 'Money':
                return NumberOperators;
            case 'DateTime':
                return DateOperators;
            case 'ID':
                return IDOperators;
            default:
                return;
        }
    }

    const FilterInputType: GraphQLInputObjectType = new GraphQLInputObjectType({
        name: inputName,
        fields: () => {
            const namedFields = fields.reduce((result, field) => {
                const fieldType = field.type;
                const filterType = isInputObjectType(fieldType) ? fieldType : getFilterType(field);
                if (!filterType) {
                    return result;
                }
                const fieldConfig: GraphQLInputFieldConfig = {
                    type: filterType,
                    description: field.description,
                };
                return {
                    ...result,
                    [field.name]: fieldConfig,
                };
            }, {} as GraphQLInputFieldConfigMap);
            return {
                ...withExistingFieldsFirst(namedFields, existingInput),
                _and: { type: new GraphQLList(new GraphQLNonNull(FilterInputType)) },
                _or: { type: new GraphQLList(new GraphQLNonNull(FilterInputType)) },
            };
        },
    });

    return FilterInputType;
}

function getCommonTypes(schema: GraphQLSchema) {
    const SortOrder = schema.getType('SortOrder') as GraphQLEnumType | null;
    const StringOperators = schema.getType('StringOperators') as GraphQLInputType | null;
    const BooleanOperators = schema.getType('BooleanOperators') as GraphQLInputType | null;
    const NumberRange = schema.getType('NumberRange') as GraphQLInputType | null;
    const NumberOperators = schema.getType('NumberOperators') as GraphQLInputType | null;
    const DateRange = schema.getType('DateRange') as GraphQLInputType | null;
    const DateOperators = schema.getType('DateOperators') as GraphQLInputType | null;
    const IDOperators = schema.getType('IDOperators') as GraphQLInputType | null;
    if (
        !SortOrder ||
        !StringOperators ||
        !BooleanOperators ||
        !NumberRange ||
        !NumberOperators ||
        !DateRange ||
        !DateOperators ||
        !IDOperators
    ) {
        throw new Error('A common type was not defined');
    }
    return {
        SortOrder,
        StringOperators,
        BooleanOperators,
        NumberOperators,
        DateOperators,
        IDOperators,
    };
}

/**
 * Unwraps the inner type if it is inside a non-nullable type
 */
function unwrapNonNullType(
    type: GraphQLOutputType | GraphQLInputType,
): GraphQLNamedType | GraphQLList<GraphQLOutputType | GraphQLInputType> {
    if (isNonNullType(type)) {
        return type.ofType;
    }
    return type;
}
