/* eslint-disable no-console */
import { GraphQLTypesLoader } from '@nestjs/graphql';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import {
    DefaultLogger,
    getConfig,
    getFinalVendureSchema,
    LogLevel,
    runPluginConfigurations,
    setConfig,
    VendureConfig,
} from '@vendure/core';
import { writeFileSync } from 'fs';
import { getIntrospectionQuery, graphqlSync } from 'graphql';
import path from 'path';

const VENDURE_SHOP_API_TYPE_PATHS = ['shop-api', 'common'].map(p =>
    path.join(__dirname, '../../packages/core/src/api/schema', p, '*.graphql'),
);

const VENDURE_ADMIN_API_TYPE_PATHS = ['admin-api', 'common'].map(p =>
    path.join(__dirname, '../../packages/core/src/api/schema', p, '*.graphql'),
);

export const config: VendureConfig = {
    apiOptions: {
        port: 3355,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: 'superadmin',
            password: 'superadmin',
        },
    },
    dbConnectionOptions: {
        type: 'sqljs',
        synchronize: true,
        logging: false,
    },
    paymentOptions: {
        paymentMethodHandlers: [],
    },
    plugins: [AdminUiPlugin],
    logger: new DefaultLogger({ level: LogLevel.Verbose }),
};

/**
 * Makes an introspection query to the Vendure server and writes the result to a
 * schema.json file.
 *
 * If there is an error connecting to the server, the promise resolves to false.
 */
export async function downloadIntrospectionSchema(apiType: 'shop' | 'admin'): Promise<boolean> {
    try {
        await setConfig(config ?? {});
        const runtimeConfig = await runPluginConfigurations(getConfig());
        const typesLoader = new GraphQLTypesLoader();
        const schema = await getFinalVendureSchema({
            config: runtimeConfig,
            typePaths: apiType === 'admin' ? VENDURE_ADMIN_API_TYPE_PATHS : VENDURE_SHOP_API_TYPE_PATHS,
            typesLoader,
            apiType: apiType,
        });
        const fileName = `schema-${apiType}.json`;
        const outFile = path.join(process.cwd(), fileName);
        const jsonSchema = graphqlSync({
            schema,
            source: getIntrospectionQuery({ inputValueDeprecation: true }),
        });
        writeFileSync(outFile, JSON.stringify(jsonSchema));
        console.log(`Generated schema: ${outFile}`);
        return true;
    } catch (error) {
        console.error('An error occured when generating Introspection Schema');
        throw error;
    }
}
