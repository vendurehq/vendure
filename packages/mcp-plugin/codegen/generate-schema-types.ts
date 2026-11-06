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

// The built (ESM) output, as the TypeScript source uses ESM-only `.js` import specifiers.
// Requires the dashboard to be built (`bun run build`), like @vendure/core.
import { writeGqlTadaIntrospectionFile } from '../../dashboard/dist/vite/utils/gql-tada-output.js';
import { McpPlugin } from '../src/plugin';

/**
 * Produces the schema description that `src/dashboard/mcp.graphql.ts` types its queries with.
 * It describes a server running nothing but this plugin. Nothing this produces reaches the
 * published package or runs at run time.
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

    // gql.tada reads the schema from a file, so write it to a temp dir.
    const tempDir = join(tmpdir(), 'mcp-plugin-schema');
    mkdirSync(tempDir, { recursive: true });
    const schemaPath = join(tempDir, 'schema.graphql');
    writeFileSync(schemaPath, sdl);

    const outputDir = join(__dirname, 'generated');
    await writeGqlTadaIntrospectionFile({ schemaPath, outputPath: join(outputDir, 'graphql-env.d.ts') });

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
