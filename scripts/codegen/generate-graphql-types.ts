import { generate } from '@graphql-codegen/cli';
import { Types } from '@graphql-codegen/plugin-helpers';
import fs from 'fs';
import path from 'path';

import { downloadIntrospectionSchema } from './download-introspection-schema';

const CLIENT_QUERY_FILES = [
    path.join(__dirname, '../../packages/admin-ui/src/lib/core/src/data/definitions/**/*.ts'),
    path.join(__dirname, '../../packages/admin-ui/src/lib/**/*.ts'),
];

const ADMIN_SCHEMA_OUTPUT_FILE = path.join(__dirname, '../../schema-admin.json');
const SHOP_SCHEMA_OUTPUT_FILE = path.join(__dirname, '../../schema-shop.json');

/* eslint-disable no-console */

Promise.all([downloadIntrospectionSchema('admin'), downloadIntrospectionSchema('shop')])
    .then(([adminSchemaSuccess, shopSchemaSuccess]) => {
        if (!adminSchemaSuccess || !shopSchemaSuccess) {
            console.log('Attempting to generate types from existing schema json files...');
        }

        const adminSchemaJson = JSON.parse(fs.readFileSync(ADMIN_SCHEMA_OUTPUT_FILE, 'utf-8'));
        const shopSchemaJson = JSON.parse(fs.readFileSync(SHOP_SCHEMA_OUTPUT_FILE, 'utf-8'));

        const config = {
            namingConvention: {
                enumValues: 'keep',
            },
            strict: true,
            scalars: {
                Money: 'number',
            },
        };
        const e2eConfig = {
            ...config,
            skipTypename: true,
        };
        const disableEsLintPlugin = { add: { content: '/* eslint-disable */' } };
        const graphQlErrorsPlugin = path.join(__dirname, './plugins/graphql-errors-plugin.js');
        const commonPlugins = [disableEsLintPlugin, 'typescript'];
        const clientPlugins = [...commonPlugins, 'typescript-operations', 'typed-document-node'];

        const codegenConfig: Types.Config = {
            overwrite: true,
            generates: {
                [path.join(
                    __dirname,
                    '../../packages/core/src/common/error/generated-graphql-admin-errors.ts',
                )]: {
                    schema: [ADMIN_SCHEMA_OUTPUT_FILE],
                    plugins: [disableEsLintPlugin, graphQlErrorsPlugin],
                },
                [path.join(
                    __dirname,
                    '../../packages/core/src/common/error/generated-graphql-shop-errors.ts',
                )]: {
                    schema: [SHOP_SCHEMA_OUTPUT_FILE],
                    plugins: [disableEsLintPlugin, graphQlErrorsPlugin],
                },
                [path.join(__dirname, '../../packages/admin-ui/src/lib/core/src/common/generated-types.ts')]:
                    {
                        schema: [ADMIN_SCHEMA_OUTPUT_FILE, path.join(__dirname, 'client-schema.ts')],
                        documents: CLIENT_QUERY_FILES,
                        plugins: clientPlugins,
                        config: {
                            ...config,
                            skipTypeNameForRoot: true,
                        },
                    },
                [path.join(
                    __dirname,
                    '../../packages/admin-ui/src/lib/core/src/common/introspection-result.ts',
                )]: {
                    schema: [ADMIN_SCHEMA_OUTPUT_FILE, path.join(__dirname, 'client-schema.ts')],
                    documents: CLIENT_QUERY_FILES,
                    plugins: [disableEsLintPlugin, 'fragment-matcher'],
                    config: { ...config, apolloClientVersion: 3 },
                },
                [path.join(__dirname, '../../packages/common/src/generated-types.ts')]: {
                    schema: [ADMIN_SCHEMA_OUTPUT_FILE],
                    plugins: commonPlugins,
                    config: {
                        ...config,
                        scalars: {
                            ...(config.scalars ?? {}),
                            ID: 'string | number',
                        },
                        maybeValue: 'T',
                    },
                },
                [path.join(__dirname, '../../packages/common/src/generated-shop-types.ts')]: {
                    schema: [SHOP_SCHEMA_OUTPUT_FILE],
                    plugins: commonPlugins,
                    config: {
                        ...config,
                        scalars: {
                            ...(config.scalars ?? {}),
                            ID: 'string | number',
                        },
                        maybeValue: 'T',
                    },
                },
            },
        };
        return generate(codegenConfig);
    })
    .then(
        result => {
            process.exit(0);
        },
        err => {
            console.error(err);
            process.exit(1);
        },
    );
