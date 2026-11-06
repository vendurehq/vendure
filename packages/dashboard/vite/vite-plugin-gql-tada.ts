import * as fs from 'fs/promises';
import { printSchema } from 'graphql';
import * as path from 'path';
import { Plugin } from 'vite';

import { writeGqlTadaIntrospectionFile } from './utils/gql-tada-output.js';
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
            await fs.mkdir(options.tempDir, { recursive: true });

            const schemaPath = path.join(options.tempDir, 'schema.graphql');
            await fs.writeFile(schemaPath, printSchema(safeSchema));

            await writeGqlTadaIntrospectionFile({
                schemaPath,
                outputPath: path.join(options.gqlTadaOutputPath, 'graphql-env.d.ts'),
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
