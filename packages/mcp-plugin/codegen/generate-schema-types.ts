import { generateOutput } from '@gql.tada/cli-utils';
import { GraphQLTypesLoader } from '@nestjs/graphql';
import {
    getConfig,
    getFinalVendureSchema,
    runPluginConfigurations,
    setConfig,
    VENDURE_ADMIN_API_TYPE_PATHS,
    VendureConfig,
} from '@vendure/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpPlugin } from '../src/plugin';

/**
 * Produces the schema description that lets TypeScript check this plugin's dashboard code on
 * its own. The dashboard code imports `graphql` from `@/gql`. In a real Vendure project that
 * import resolves to types the project generates from its whole server; this plugin has no
 * such server, so this script describes a server running nothing but the plugin and points
 * `@/gql` at that description while developing. Nothing this produces reaches the published
 * package or runs at run time.
 *
 * Run with `bun run codegen:dashboard` after changing `src/api/api-extensions.ts`.
 */

// The Admin API of a server running only this plugin. The script assembles the schema in
// memory: it starts no server, opens no database and makes no network request.
const config: VendureConfig = {
    apiOptions: { port: 3000 },
    authOptions: { tokenMethod: 'bearer' },
    dbConnectionOptions: { type: 'sqljs' },
    paymentOptions: { paymentMethodHandlers: [] },
    plugins: [McpPlugin.init()],
};

async function generate() {
    await setConfig(config);
    const runtimeConfig = await runPluginConfigurations(getConfig());
    const sdl = (await getFinalVendureSchema({
        config: runtimeConfig,
        typePaths: VENDURE_ADMIN_API_TYPE_PATHS,
        typesLoader: new GraphQLTypesLoader(),
        apiType: 'admin',
        output: 'sdl',
    })) as unknown as string;

    // gql.tada reads the schema from a file named in a tsconfig, so hand it both in a temp dir.
    const tempDir = join(tmpdir(), 'mcp-plugin-schema');
    mkdirSync(tempDir, { recursive: true });
    const schemaPath = join(tempDir, 'schema.graphql');
    writeFileSync(schemaPath, sdl);
    const tsConfigPath = join(tempDir, 'tsconfig.json');
    writeFileSync(
        tsConfigPath,
        JSON.stringify({
            compilerOptions: {
                plugins: [{ name: 'gql.tada/ts-plugin', schema: './schema.graphql' }],
            },
        }),
    );

    const outputDir = join(__dirname, 'generated');
    mkdirSync(outputDir, { recursive: true });
    await generateOutput({
        output: join(outputDir, 'graphql-env.d.ts'),
        tsconfig: tsConfigPath,
    });

    /* eslint-disable no-console */
    console.log(`Schema written to ${schemaPath}`);
    console.log(`Types written to ${join(outputDir, 'graphql-env.d.ts')}`);
    /* eslint-enable no-console */
}

generate().catch(err => {
    /* eslint-disable-next-line no-console */
    console.error('Failed to generate the dashboard schema description:', err);
    process.exit(1);
});
