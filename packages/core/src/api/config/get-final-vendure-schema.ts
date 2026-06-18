import { GraphQLTypesLoader } from '@nestjs/graphql';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { buildSchema, extendSchema, GraphQLSchema, printSchema } from 'graphql/index';
import path from 'path';

import {
    AutoIncrementIdStrategy,
    EntityIdStrategy,
    RuntimeVendureConfig,
    UuidIdStrategy,
} from '../../config/index';
import { getPluginAPIExtensions } from '../../plugin/plugin-metadata';

import { generateActiveOrderTypes } from './generate-active-order-types';
import { generateAuthenticationTypes } from './generate-auth-types';
import { generateErrorCodeEnum } from './generate-error-code-enum';
import { generateListOptions } from './generate-list-options';
import { generatePermissionEnum } from './generate-permissions';
import {
    addActiveAdministratorCustomFields,
    addGraphQLCustomFields,
    addModifyOrderCustomFields,
    addOrderLineCustomFieldsInput,
    addPaymentMethodQuoteCustomFields,
    addRegisterCustomerCustomFieldsInput,
    addServerConfigCustomFields,
    addShippingMethodQuoteCustomFields,
} from './graphql-custom-fields';

type GetSchemaOptions = {
    config: RuntimeVendureConfig;
    typePaths: string[];
    typesLoader: GraphQLTypesLoader;
    apiType: 'shop' | 'admin';
};
type GetSchemaAsSDLOptions = GetSchemaOptions & { output: 'sdl' };

/**
 * @description
 * Build the full Vendure GraphQL schema, including any custom fields, API extensions,
 * custom scalars etc. defined in plugins.
 *
 * By setting the `output` option to `'sdl'`, the schema can be output as an SDL string.
 * This is safe to use in scenarios where there might be multiple versions of
 * the `graphql` package installed, where otherwise passing around the actual
 * `GraphQLSchema` object might lead to conflicts.
 *
 * @example
 * ```ts
 * import { getFinalVendureSchema, VENDURE_ADMIN_API_TYPE_PATHS } from '\@vendure/core';
 * import { GraphQLTypesLoader } from '@nestjs/graphql';
 *
 * import { config } from './vendure-config';
 *
 * const typesLoader = new GraphQLTypesLoader();
 *
 * const finalSchema = await getFinalVendureSchema({
 *     config,
 *     typePaths: VENDURE_ADMIN_API_TYPE_PATHS,
 *     typesLoader,
 *     apiType: 'admin',
 *     output: 'sdl',
 * });
 * ```
 *
 * @param options
 */
export async function getFinalVendureSchema(options: GetSchemaOptions): Promise<GraphQLSchema>;
export async function getFinalVendureSchema(options: GetSchemaAsSDLOptions): Promise<string>;
export async function getFinalVendureSchema(
    options: GetSchemaOptions & { output?: 'sdl' },
): Promise<GraphQLSchema | string> {
    const { config, typePaths, typesLoader, apiType } = options;
    // Paths must be normalized to use forward-slash separators.
    // See https://github.com/nestjs/graphql/issues/336
    const normalizedPaths = typePaths.map(p => p.split(path.sep).join('/'));
    const typeDefs = await typesLoader.mergeTypesByPaths(normalizedPaths);
    let schema = buildSchema(typeDefs);
    schema = buildSchemaFromVendureConfig(schema, config, apiType);
    if (options.output === 'sdl') {
        return printSchema(schema);
    } else {
        return schema;
    }
}

export function buildSchemaFromVendureConfig(
    schema: GraphQLSchema,
    config: RuntimeVendureConfig,
    apiType: 'shop' | 'admin',
): GraphQLSchema {
    const authStrategies =
        apiType === 'shop'
            ? config.authOptions.shopAuthenticationStrategy
            : config.authOptions.adminAuthenticationStrategy;

    const customFields = config.customFields;

    schema = extendSchemaWithPluginApiExtensions(schema, config.plugins, apiType);
    schema = generateListOptions(schema);
    schema = addGraphQLCustomFields(schema, customFields, apiType === 'shop');
    schema = addOrderLineCustomFieldsInput(schema, customFields.OrderLine || [], apiType === 'shop');
    schema = addModifyOrderCustomFields(schema, customFields.Order || []);
    schema = addShippingMethodQuoteCustomFields(schema, customFields.ShippingMethod || []);
    schema = addPaymentMethodQuoteCustomFields(schema, customFields.PaymentMethod || []);
    schema = generateAuthenticationTypes(schema, authStrategies);
    schema = generateErrorCodeEnum(schema);
    if (apiType === 'admin') {
        schema = addServerConfigCustomFields(schema, customFields);
        schema = addActiveAdministratorCustomFields(schema, customFields.Administrator);
    }
    if (apiType === 'shop') {
        schema = addRegisterCustomerCustomFieldsInput(schema, customFields.Customer || []);
        schema = generateActiveOrderTypes(schema, config.orderOptions.activeOrderStrategy);
    }
    schema = generatePermissionEnum(schema, config.authOptions.customPermissions);

    return schema;
}

function extendSchemaWithPluginApiExtensions(
    schema: GraphQLSchema,
    plugins: RuntimeVendureConfig['plugins'],
    apiType: 'admin' | 'shop',
) {
    getPluginAPIExtensions(plugins, apiType)
        .map(e => (typeof e.schema === 'function' ? e.schema(schema) : e.schema))
        .filter(notNullOrUndefined)
        .forEach(documentNode => (schema = extendSchema(schema, documentNode)));
    return schema;
}

export function isUsingDefaultEntityIdStrategy(entityIdStrategy: EntityIdStrategy<any>): boolean {
    return (
        entityIdStrategy.constructor === AutoIncrementIdStrategy ||
        entityIdStrategy.constructor === UuidIdStrategy
    );
}
