import { log } from '@clack/prompts';
import type { GraphQLTypesLoader as GraphQLTypesLoaderType } from '@nestjs/graphql';
import { writeFileSync } from 'fs-extra';
import { getIntrospectionQuery, graphqlSync, printSchema } from 'graphql';
import path from 'node:path';

import { exitCliCommand, rethrowCliCommandExit } from '../../../shared/cli-command-exit';
import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file';
import { requireFromProject, requireProjectCore } from '../../../shared/project-core';
import { analyzeProject } from '../../../shared/shared-prompts';
import { VendureConfigRef } from '../../../shared/vendure-config-ref';
import { type SchemaOptions } from '../schema';

const cancelledMessage = 'Generate schema cancelled';

export async function generateSchema(options: SchemaOptions) {
    // The project's own Vendure. `setConfig` and `getConfig` read and write a
    // singleton held inside the package, and the project's `vendure-config.ts`
    // is compiled against the copy installed in the project. Loading a
    // different copy here would give the two of them separate singletons, so
    // the config written below would not be the config read back.
    const core = requireProjectCore();
    core.resetConfig();
    try {
        const { project, vendureTsConfig } = await analyzeProject({ cancelledMessage });
        const vendureConfig = new VendureConfigRef(project, options.config);
        log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());
        const config = await loadVendureConfigFile(vendureConfig, vendureTsConfig);
        await core.setConfig(config);

        const apiType = options.api === 'shop' ? 'shop' : 'admin';
        const typePaths =
            apiType === 'shop' ? core.VENDURE_SHOP_API_TYPE_PATHS : core.VENDURE_ADMIN_API_TYPE_PATHS;

        const runtimeConfig = await core.runPluginConfigurations(core.getConfig() as any);
        const { GraphQLTypesLoader } = requireFromProject<{
            GraphQLTypesLoader: new () => GraphQLTypesLoaderType;
        }>('@nestjs/graphql');
        const typesLoader = new GraphQLTypesLoader();
        const schema = await core.getFinalVendureSchema({
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
    } catch (e: unknown) {
        rethrowCliCommandExit(e);
        log.error(e instanceof Error ? e.message : String(e));
        exitCliCommand(1);
    }
}
