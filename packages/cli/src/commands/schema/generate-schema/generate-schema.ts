import { log } from '@clack/prompts';
import { GraphQLTypesLoader } from '@nestjs/graphql';
import {
    getConfig,
    getFinalVendureSchema,
    resetConfig,
    runPluginConfigurations,
    setConfig,
    VENDURE_ADMIN_API_TYPE_PATHS,
    VENDURE_SHOP_API_TYPE_PATHS,
} from '@vendure/core';
import { writeFileSync } from 'fs-extra';
import { getIntrospectionQuery, graphqlSync, printSchema } from 'graphql';
import path from 'node:path';

import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file';
import { analyzeProject } from '../../../shared/shared-prompts';
import { VendureConfigRef } from '../../../shared/vendure-config-ref';
import { type SchemaOptions } from '../schema';

const cancelledMessage = 'Generate schema cancelled';

export async function generateSchema(options: SchemaOptions) {
    resetConfig();
    try {
        const { project, vendureTsConfig } = await analyzeProject({ cancelledMessage });
        const vendureConfig = new VendureConfigRef(project, options.config);
        log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());
        const config = await loadVendureConfigFile(vendureConfig, vendureTsConfig);
        await setConfig(config);

        const apiType = options.api === 'shop' ? 'shop' : 'admin';
        const typePaths = apiType === 'shop' ? VENDURE_SHOP_API_TYPE_PATHS : VENDURE_ADMIN_API_TYPE_PATHS;

        const runtimeConfig = await runPluginConfigurations(getConfig() as any);
        const typesLoader = new GraphQLTypesLoader();
        const schema = await getFinalVendureSchema({
            config: runtimeConfig,
            typePaths,
            typesLoader,
            apiType,
        });
        const format = options.format === 'json' ? 'json' : 'sdl';
        const ext = format === 'sdl' ? 'graphql' : 'json';
        const fileName = options.fileName ?? `schema${apiType === 'shop' ? '-shop' : ''}.${ext}`;
        const outFile = path.join(options.outputDir ?? process.cwd(), fileName);
        if (format === 'sdl') {
            writeFileSync(outFile, printSchema(schema));
        } else {
            const jsonSchema = graphqlSync({
                schema,
                source: getIntrospectionQuery(),
            }).data;
            writeFileSync(outFile, JSON.stringify(jsonSchema));
        }
        log.info(`Generated schema: ${outFile}`);
    } catch (e) {
        log.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
    }
}
