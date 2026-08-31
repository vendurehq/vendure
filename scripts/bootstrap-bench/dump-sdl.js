/**
 * Dumps the final admin + shop schema SDL (plain and heavy configs) to files, for
 * verifying that schema-build refactors produce identical schemas.
 * Usage: node scripts/bootstrap-bench/dump-sdl.js <outDir>
 */
const fs = require('node:fs');
const path = require('node:path');
const core = require('@vendure/core');
const { GraphQLTypesLoader } = require('@nestjs/graphql');
const { getBenchConfig } = require('./bench-config');
const constants = require('@vendure/core/dist/api/constants.js');
const { resolveInRepo } = require('./resolve-in-repo');

const outDir = resolveInRepo(process.argv[2], 'output dir');
fs.mkdirSync(outDir, { recursive: true });

async function main() {
    const typesLoader = new GraphQLTypesLoader();
    const variant = process.env.BENCH_HEAVY === '1' ? 'heavy' : 'plain';
    const config = await core.preBootstrapConfig(getBenchConfig(core));
    for (const apiType of ['admin', 'shop']) {
        const typePaths =
            apiType === 'admin'
                ? constants.VENDURE_ADMIN_API_TYPE_PATHS
                : constants.VENDURE_SHOP_API_TYPE_PATHS;
        const sdl = await core.getFinalVendureSchema({
            config,
            typePaths,
            typesLoader,
            apiType,
            output: 'sdl',
        });
        const file = path.join(outDir, `${variant}-${apiType}.graphql`);
        fs.writeFileSync(file, sdl);
        console.log(`wrote ${file} (${sdl.length} chars)`);
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
