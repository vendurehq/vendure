import { log } from '@clack/prompts';
import type { GraphQLTypesLoader as GraphQLTypesLoaderType } from '@nestjs/graphql';
import type { VendureConfig } from '@vendure/core';
import fs from 'fs-extra';
import path from 'node:path';

import { exitCliCommand, rethrowCliCommandExit } from '../../../shared/cli-command-exit.js';
import { configResolverFailed } from '../../../shared/config-resolver.errors.js';
import { ConfigResolverFailedError, resolveProjectConfig } from '../../../shared/load-project-config.js';
import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file.js';
import { requireFromProjectCore, requireProjectCore } from '../../../shared/project-core.js';
import { analyzeProject } from '../../../shared/shared-prompts.js';
import { VendureConfigRef } from '../../../shared/vendure-config-ref.js';
import { type SchemaOptions } from '../schema.js';

const cancelledMessage = 'Generate schema cancelled';

export async function generateSchema(options: SchemaOptions) {
    // The project's own Vendure. `setConfig` and `getConfig` read and write a
    // singleton held inside the package, and the project's `vendure-config.ts`
    // is compiled against the copy installed in the project. Loading a
    // different copy here would give the two of them separate singletons, so
    // the config written below would not be the config read back.
    const core = requireProjectCore();
    // The GraphQL that the project's core uses, for the same reason as core,
    // and for one more: the schema these functions are given was built by
    // core's copy. Two physical copies of the same version do not recognise
    // each other's types, so printing a core schema with any other copy fails
    // with "Cannot use GraphQLObjectType from another module or realm".
    const { getIntrospectionQuery, graphqlSync, printSchema } =
        requireFromProjectCore<typeof import('graphql')>('graphql');
    core.resetConfig();
    try {
        const config = await loadSchemaConfig(options.config);
        await core.setConfig(config);

        const apiType = options.api === 'shop' ? 'shop' : 'admin';
        const typePaths =
            apiType === 'shop' ? core.VENDURE_SHOP_API_TYPE_PATHS : core.VENDURE_ADMIN_API_TYPE_PATHS;

        const runtimeConfig = await core.runPluginConfigurations(core.getConfig() as any);
        const { GraphQLTypesLoader } = requireFromProjectCore<{
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
            fs.writeFileSync(outFile, printSchema(schema));
        } else {
            const jsonSchema = graphqlSync({
                schema,
                source: getIntrospectionQuery(),
            }).data;
            fs.writeFileSync(outFile, JSON.stringify(jsonSchema));
        }
        log.info(`Generated schema: ${outFile}`);
    } catch (e: unknown) {
        rethrowCliCommandExit(e);
        const message = e instanceof Error ? e.message : String(e);
        log.error(
            e instanceof ConfigResolverFailedError ? `${configResolverFailed.code}: ${message}` : message,
        );
        exitCliCommand(1);
    }
}

/**
 * The project's config, from the config resolver of an enabled package, or else from the
 * `VendureConfig` in its source.
 */
async function loadSchemaConfig(configFile: string | undefined): Promise<VendureConfig> {
    const resolved = await resolveProjectConfig({ configFile });
    if (resolved) {
        log.info('Using the VendureConfig resolved by ' + resolved.resolvedBy);
        return resolved.config;
    }
    const { project, vendureTsConfig } = await analyzeProject({ cancelledMessage });
    const vendureConfig = new VendureConfigRef(project, configFile);
    log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());
    return loadVendureConfigFile(vendureConfig, vendureTsConfig);
}
