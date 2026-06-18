import {
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLSchema,
    GraphQLType,
    isEnumType,
    isInputObjectType,
    isObjectType,
    isScalarType,
} from 'graphql';
import { Plugin } from 'vite';

import { ConfigLoaderApi, getConfigLoaderApi } from './vite-plugin-config-loader.js';

export type FieldInfoTuple = readonly [
    type: string,
    nullable: boolean,
    list: boolean,
    isPaginatedList: boolean,
];

export interface SchemaInfo {
    types: {
        [typename: string]: {
            [fieldname: string]: FieldInfoTuple;
        };
    };
    inputs: {
        [typename: string]: {
            [fieldname: string]: FieldInfoTuple;
        };
    };
    scalars: string[];
    enums: {
        [typename: string]: string[];
    };
}

const virtualModuleId = 'virtual:admin-api-schema';
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

export function adminApiSchemaPlugin(): Plugin {
    let configLoaderApi: ConfigLoaderApi;
    let schemaInfo: SchemaInfo;

    return {
        name: 'vendure:admin-api-schema',
        configResolved({ plugins }) {
            configLoaderApi = getConfigLoaderApi(plugins);
        },
        async buildStart() {
            const { vendureConfig } = await configLoaderApi.getVendureConfig();
            if (!schemaInfo) {
                const { generateSchema } = await import('./utils/schema-generator.js');
                const safeSchema = await generateSchema({ vendureConfig });
                schemaInfo = generateSchemaInfo(safeSchema);
            }
        },
        resolveId(id) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
        },
        load(id) {
            if (id === resolvedVirtualModuleId) {
                return `
                    export const schemaInfo = ${JSON.stringify(schemaInfo)};
                `;
            }
        },
    };
}

function getTypeInfo(type: GraphQLType) {
    let nullable = true;
    let list = false;
    let isPaginatedList = false;

    // Unwrap NonNull
    if (type instanceof GraphQLNonNull) {
        nullable = false;
        type = type.ofType;
    }

    // Unwrap List
    if (type instanceof GraphQLList) {
        list = true;
        type = type.ofType;
    }

    if (type instanceof GraphQLObjectType) {
        if (type.getInterfaces().some(i => i.name === 'PaginatedList')) {
            isPaginatedList = true;
        }
    }

    return [type.toString().replace(/!$/, ''), nullable, list, isPaginatedList] as const;
}

function generateSchemaInfo(schema: GraphQLSchema): SchemaInfo {
    const types = schema.getTypeMap();
    const result: SchemaInfo = { types: {}, inputs: {}, scalars: [], enums: {} };

    Object.values(types).forEach(type => {
        if (isObjectType(type)) {
            const fields = type.getFields();
            result.types[type.name] = {};

            Object.entries(fields).forEach(([fieldName, field]) => {
                result.types[type.name][fieldName] = getTypeInfo(field.type);
            });
        }
        if (isInputObjectType(type)) {
            const fields = type.getFields();
            result.inputs[type.name] = {};

            Object.entries(fields).forEach(([fieldName, field]) => {
                result.inputs[type.name][fieldName] = getTypeInfo(field.type);
            });
        }
        if (isScalarType(type)) {
            result.scalars.push(type.name);
        }
        if (isEnumType(type)) {
            result.enums[type.name] = type.getValues().map(v => v.value);
        }
    });

    return result;
}
