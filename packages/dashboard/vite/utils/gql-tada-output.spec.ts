import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeGqlTadaIntrospectionFile } from './gql-tada-output.js';

const schemaSdl = /* GraphQL */ `
    type Query {
        product(id: ID!): Product
    }

    type Product {
        id: ID!
        name: String!
        status: ProductStatus!
    }

    enum ProductStatus {
        ACTIVE
        ARCHIVED
    }
`;

describe('writeGqlTadaIntrospectionFile()', () => {
    let tempDir: string;
    let schemaPath: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(path.join(tmpdir(), 'vendure-gql-tada-output-'));
        schemaPath = path.join(tempDir, 'schema.graphql');
        await writeFile(schemaPath, schemaSdl);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('writes a .d.ts introspection file in the gql.tada format', { timeout: 30_000 }, async () => {
        const outputPath = path.join(tempDir, 'out', 'graphql-env.d.ts');

        await writeGqlTadaIntrospectionFile({ schemaPath, outputPath });

        const output = await readFile(outputPath, 'utf-8');
        expect(output).toContain('export type introspection_types = {');
        expect(output).toContain(
            "'ProductStatus': { name: 'ProductStatus'; enumValues: 'ACTIVE' | 'ARCHIVED'; };",
        );
        expect(output).toContain("'Product': { kind: 'OBJECT'; name: 'Product';");
        expect(output).toContain("query: 'Query';");
        expect(output).toContain("declare module 'gql.tada' {");
        expect(output).toContain('introspection: introspection');
    });

    it('keeps the header of an existing output file', { timeout: 30_000 }, async () => {
        const outputPath = path.join(tempDir, 'graphql-env.d.ts');
        await writeGqlTadaIntrospectionFile({ schemaPath, outputPath });
        const customHeader = '/* eslint-disable */\n/* Custom header */\n';
        const original = await readFile(outputPath, 'utf-8');
        await writeFile(outputPath, customHeader + original.replace(/^\/\*[\s\S]*?\*\/\n/, ''));

        await writeGqlTadaIntrospectionFile({ schemaPath, outputPath });

        const output = await readFile(outputPath, 'utf-8');
        expect(output.startsWith(customHeader)).toBe(true);
    });

    it('does not rewrite the file when the output is unchanged', { timeout: 30_000 }, async () => {
        const outputPath = path.join(tempDir, 'graphql-env.d.ts');
        await writeGqlTadaIntrospectionFile({ schemaPath, outputPath });
        const firstWrite = await stat(outputPath);

        await new Promise(resolve => setTimeout(resolve, 20));
        await writeGqlTadaIntrospectionFile({ schemaPath, outputPath });

        const secondWrite = await stat(outputPath);
        expect(secondWrite.mtimeMs).toBe(firstWrite.mtimeMs);
    });
});
