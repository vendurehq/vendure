import { mergeConfig } from '@vendure/core';
import {
    createTestEnvironment,
    testConfig as defaultTestConfig,
    registerInitializer,
    SqljsInitializer,
} from '@vendure/testing';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { VENDURE_PORT } from './constants.js';
import { e2eCustomFields, e2ePaymentMethodHandlers } from './fixtures/e2e-shared-config.js';
import { initialData } from './fixtures/initial-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

/**
 * Compiles a TypeScript fixture with SWC so that NestJS parameter decorators
 * and emitDecoratorMetadata work correctly. Playwright's built-in transpiler
 * (esbuild/Babel) does not support these features.
 */
async function importWithSwc<T>(fixturePath: string): Promise<T> {
    const { transformFileSync } = await import('@swc/core');
    const { code } = transformFileSync(fixturePath, {
        jsc: {
            parser: { syntax: 'typescript', decorators: true },
            transform: { decoratorMetadata: true, useDefineForClassFields: false },
            target: 'es2017',
        },
        module: { type: 'es6' },
    });
    const outDir = path.join(__dirname, 'fixtures', '.compiled');
    const outFile = path.join(outDir, path.basename(fixturePath).replace(/\.ts$/, '.mjs'));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, code);
    return import(pathToFileURL(outFile).href) as Promise<T>;
}

export default async function globalSetup() {
    // CustomHistoryEntryPlugin uses NestJS constructor injection which requires
    // SWC compilation (emitDecoratorMetadata). It is loaded dynamically here
    // rather than statically imported because Playwright's built-in TypeScript
    // transpiler (esbuild/Babel) does not support emitDecoratorMetadata.
    const { CustomHistoryEntryPlugin } = await importWithSwc<{
        CustomHistoryEntryPlugin: new () => unknown;
    }>(path.join(__dirname, 'fixtures', 'custom-history-entry-plugin.ts'));

    const config = mergeConfig(defaultTestConfig, {
        apiOptions: {
            port: VENDURE_PORT,
        },
        paymentOptions: {
            paymentMethodHandlers: e2ePaymentMethodHandlers,
        },
        plugins: [CustomHistoryEntryPlugin],
        customFields: e2eCustomFields,
    });

    // mergeConfig won't replace a boolean with an object, so set CORS explicitly.
    // The dashboard's fetch uses credentials: 'include', which requires the server
    // to reflect the request origin (not wildcard *) and set credentials: true.
    config.apiOptions.cors = {
        origin: true,
        credentials: true,
    };

    const { server } = createTestEnvironment(config);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-full.csv'),
        customerCount: 5,
    });
    (globalThis as any).__VENDURE_SERVER__ = server;
}
