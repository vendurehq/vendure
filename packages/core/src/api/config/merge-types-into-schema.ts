import {
    GraphQLNamedType,
    GraphQLObjectType,
    GraphQLSchema,
    // Importing this from graphql/index.js is a workaround for the dual-package
    // hazard issue when testing this file in vitest. See https://github.com/vitejs/vite/issues/7879
} from 'graphql/index.js';

/**
 * Rebuilds the schema with the given types added, replacing any existing types of the
 * same name and rewiring all references to a replaced type throughout the schema.
 * Types defined in `additionalSchemas` are also added, except where the main schema
 * already defines a type of the same name, which then takes precedence.
 *
 * This performs a single rebuild pass over the type map, which is far cheaper than
 * a single-subschema `stitchSchemas()` call, since that also constructs a proxying
 * wrapper schema and runs multi-schema merge machinery which is not needed for
 * this add-or-replace use-case.
 */
export function mergeTypesIntoSchema(
    schema: GraphQLSchema,
    types: GraphQLNamedType[],
    additionalSchemas: GraphQLSchema[] = [],
): GraphQLSchema {
    // Required lazily (and via require to prevent issues when running vitest tests)
    // so that @graphql-tools/utils is not loaded at require time of @vendure/core.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rewireTypes } = require('@graphql-tools/utils');
    const config = schema.toConfig();
    const typeMap: Record<string, GraphQLNamedType> = {};
    for (const type of config.types) {
        typeMap[type.name] = type;
    }
    for (const additional of additionalSchemas) {
        for (const type of Object.values(additional.getTypeMap())) {
            if (!type.name.startsWith('__') && !typeMap[type.name]) {
                typeMap[type.name] = type;
            }
        }
    }
    for (const type of types) {
        typeMap[type.name] = type;
    }
    const rewired = rewireTypes(typeMap, config.directives);
    return new GraphQLSchema({
        ...config,
        query: config.query && (rewired.typeMap[config.query.name] as GraphQLObjectType),
        mutation: config.mutation && (rewired.typeMap[config.mutation.name] as GraphQLObjectType),
        subscription: config.subscription && (rewired.typeMap[config.subscription.name] as GraphQLObjectType),
        types: Object.values(rewired.typeMap),
        directives: rewired.directives,
    });
}
