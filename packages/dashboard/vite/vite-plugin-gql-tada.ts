import { generateOutput } from '@gql.tada/cli-utils';
import * as fs from 'fs/promises';
import { printSchema } from 'graphql';
import * as path from 'path';
import { Plugin } from 'vite';

import { ConfigLoaderApi, getConfigLoaderApi } from './vite-plugin-config-loader.js';

export function gqlTadaPlugin(options: {
    gqlTadaOutputPath: string;
    tempDir: string;
    packageRoot: string;
}): Plugin {
    let configLoaderApi: ConfigLoaderApi;

    return {
        name: 'vendure:gql-tada',
        configResolved({ plugins }) {
            configLoaderApi = getConfigLoaderApi(plugins);
        },
        async buildStart() {
            const { vendureConfig } = await configLoaderApi.getVendureConfig();
            const { generateSchema } = await import('./utils/schema-generator.js');
            const safeSchema = await generateSchema({ vendureConfig });

            const tsConfigContent = {
                compilerOptions: {
                    plugins: [
                        {
                            name: 'gql.tada/ts-plugin',
                            schema: './schema.graphql',
                        },
                    ],
                },
            };

            const tsConfigPath = path.join(options.tempDir, 'tsconfig.json');
            await fs.writeFile(tsConfigPath, JSON.stringify(tsConfigContent, null, 2));

            const schemaPath = path.join(options.tempDir, 'schema.graphql');
            await fs.writeFile(schemaPath, printSchema(safeSchema));

            await generateOutput({
                output: path.join(options.gqlTadaOutputPath, 'graphql-env.d.ts'),
                tsconfig: tsConfigPath,
            });

            // Copy the graphql.ts file to the output path
            const graphqlTsPath = path.join(options.packageRoot, 'src/lib/graphql/graphql.ts');
            try {
                await fs.copyFile(graphqlTsPath, path.join(options.gqlTadaOutputPath, 'graphql.ts'));
            } catch (error) {
                if (error instanceof Error) {
                    this.error(error.message);
                } else {
                    this.error('Failed to copy graphql.ts file');
                }
            }
            this.info('graphql introspection files output to ' + options.gqlTadaOutputPath);
        },
    };
}
