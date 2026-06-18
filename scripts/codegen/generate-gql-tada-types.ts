import { generateOutput } from '@gql.tada/cli-utils';
import { buildClientSchema, printSchema } from 'graphql';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ADMIN_SCHEMA_JSON = join(__dirname, '../../schema-admin.json');
const SHOP_SCHEMA_JSON = join(__dirname, '../../schema-shop.json');

const PACKAGES_WITH_E2E = [
    'packages/core/e2e',
    'packages/asset-server-plugin/e2e',
];

async function generateGqlTadaTypes() {
    console.log('Generating gql.tada types for e2e tests...\n');

    for (const packagePath of PACKAGES_WITH_E2E) {
        console.log(`Processing ${packagePath}...`);
        await generateTypesForPackage(packagePath);
    }

    console.log('\n✓ All gql.tada types generated successfully');
}

async function generateTypesForPackage(packagePath: string) {
    const graphqlDir = join(__dirname, '../../', packagePath, 'graphql');
    mkdirSync(graphqlDir, { recursive: true });

    await generateTypesForApi('admin', ADMIN_SCHEMA_JSON, graphqlDir);
    await generateTypesForApi('shop', SHOP_SCHEMA_JSON, graphqlDir);
}

async function generateTypesForApi(
    apiType: 'admin' | 'shop',
    schemaJsonPath: string,
    outputDir: string,
) {
    const schemaJson = JSON.parse(readFileSync(schemaJsonPath, 'utf-8'));
    const schema = buildClientSchema(schemaJson.data);
    const sdl = printSchema(schema);

    const tempDir = join(tmpdir(), `gql-tada-${apiType}-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    const schemaPath = join(tempDir, 'schema.graphql');
    writeFileSync(schemaPath, sdl);

    const tsConfigContent = {
        compilerOptions: {
            plugins: [
                {
                    name: 'gql.tada/ts-plugin',
                    schema: schemaPath,
                },
            ],
        },
    };
    const tsConfigPath = join(tempDir, 'tsconfig.json');
    writeFileSync(tsConfigPath, JSON.stringify(tsConfigContent, null, 2));

    const outputPath = join(outputDir, `graphql-env-${apiType}.d.ts`);
    await generateOutput({
        output: outputPath,
        tsconfig: tsConfigPath,
    });

    const graphqlWrapperPath = join(outputDir, `graphql-${apiType}.ts`);
    const wrapperContent = `import type { introspection } from './graphql-env-${apiType}.d.ts';
import { initGraphQLTada } from 'gql.tada';

export const graphql = initGraphQLTada<{
    disableMasking: true;
    introspection: introspection;
    scalars: {
        DateTime: string;
        JSON: any;
        Money: number;
    };
}>();

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
export { readFragment } from 'gql.tada';
`;
    writeFileSync(graphqlWrapperPath, wrapperContent);

    console.log(`  ✓ Generated ${apiType} API types`);
}

generateGqlTadaTypes().catch(err => {
    console.error('Failed to generate gql.tada types:', err);
    process.exit(1);
});
