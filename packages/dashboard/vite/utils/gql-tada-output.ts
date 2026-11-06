// @gql.tada/internal is gql.tada's internal package, so it is pinned to the exact version that
// gql.tada itself depends on (see package.json). It is only used for its pure helpers; its
// tsconfig loading needs the TypeScript 5/6 API, which TypeScript 7 no longer provides.
import {
    extractIntrospectionHeader,
    loadRef,
    minifyIntrospection,
    outputIntrospectionFile,
} from '@gql.tada/internal';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Writes a gql.tada introspection file (e.g. `graphql-env.d.ts`) for the given SDL schema file.
 *
 * This is equivalent to `generateOutput()` from `@gql.tada/cli-utils`, but does not
 * look up a tsconfig file. gql.tada reads tsconfig files with the TypeScript 5/6 JS API
 * (`ts.parseConfigFileTextToJson`), which no longer exists in TypeScript 7.
 */
export async function writeGqlTadaIntrospectionFile(options: {
    schemaPath: string;
    outputPath: string;
}): Promise<void> {
    const { schemaPath, outputPath } = options;
    const schemaRef = await loadRef({ schema: schemaPath }).load({ rootPath: path.dirname(schemaPath) });
    const existingOutput = await fs.readFile(outputPath, 'utf-8').catch(() => undefined);
    const output = outputIntrospectionFile(minifyIntrospection(schemaRef.current.introspection), {
        fileType: outputPath,
        shouldPreprocess: true,
        preamble: existingOutput ? (extractIntrospectionHeader(existingOutput) ?? undefined) : undefined,
    });
    if (existingOutput === output) {
        return;
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, output);
}
