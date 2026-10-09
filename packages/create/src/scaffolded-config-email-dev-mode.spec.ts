import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { getCiConfiguration } from './gather-user-responses';

const PROJECT_ROOT = 'my-vendure-app';
const SRC_DIR = '/app/src';

/**
 * Runs the generated vendure-config.ts with every package import stubbed, and returns the
 * options object the config passes to `EmailPlugin.init()`.
 */
function getEmailPluginOptions(configSource: string, appEnv: string | undefined) {
    const { outputText } = ts.transpileModule(configSource, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2019,
            esModuleInterop: true,
        },
    });
    const initCalls = new Map<string, unknown>();
    const stubModule = new Proxy(
        {},
        {
            get: (_target, name) =>
                class {
                    static init(options: unknown) {
                        initCalls.set(String(name), options);
                        return {};
                    }
                },
        },
    );
    const moduleObject = { exports: {} };
    vm.runInNewContext(outputText, {
        module: moduleObject,
        exports: moduleObject.exports,
        __dirname: SRC_DIR,
        process: { env: { APP_ENV: appEnv } },
        require: (id: string) => (id === 'path' ? path : stubModule),
    });
    return initCalls.get('EmailPlugin') as Record<string, any>;
}

describe('scaffolded vendure-config EmailPlugin devMode', () => {
    let configSource: string;

    beforeAll(async () => {
        const { getPackageManagerInfo, registerTemplateHelpers } = await import('./helpers');
        registerTemplateHelpers(getPackageManagerInfo('npm'));
        ({ configSource } = await getCiConfiguration(PROJECT_ROOT, 'npm', 3000, undefined));
    });

    it('enables devMode and the dev mailbox when APP_ENV is dev', () => {
        const options = getEmailPluginOptions(configSource, 'dev');

        expect(options.devMode).toBe(true);
        expect(options.route).toBe('mailbox');
        expect(options.outputPath).toBe(path.join(SRC_DIR, '../static/email/test-emails'));
        expect(options.transport).toBeUndefined();
    });

    it.each([undefined, 'production'])(
        'does not enable devMode or the dev mailbox when APP_ENV is %s',
        appEnv => {
            const options = getEmailPluginOptions(configSource, appEnv);

            expect(options.devMode).toBeUndefined();
            expect(options.route).toBeUndefined();
            expect(options.transport).toEqual({
                type: 'file',
                outputPath: path.join(SRC_DIR, '../static/email/test-emails'),
            });
            expect(options.handlers).toBeDefined();
            expect(options.templateLoader).toBeDefined();
        },
    );
});
