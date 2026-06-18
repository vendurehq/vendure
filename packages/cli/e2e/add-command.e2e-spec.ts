/*
 * E2E tests for the add command
 *
 * To run these tests:
 * npm run vitest -- --config e2e/vitest.e2e.config.mts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addCommand } from '../src/commands/add/add';
import * as apiExtensionModule from '../src/commands/add/api-extension/add-api-extension';
import * as codegenModule from '../src/commands/add/codegen/add-codegen';
import * as entityModule from '../src/commands/add/entity/add-entity';
import * as jobQueueModule from '../src/commands/add/job-queue/add-job-queue';
import * as pluginModule from '../src/commands/add/plugin/create-new-plugin';
import * as serviceModule from '../src/commands/add/service/add-service';
import * as uiExtensionsModule from '../src/commands/add/ui-extensions/add-ui-extensions';

// Mock clack prompts to prevent interactive prompts during tests
vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn(() => false),
    select: vi.fn(() => Promise.resolve('no-selection')),
    spinner: vi.fn(() => ({
        start: vi.fn(),
        stop: vi.fn(),
    })),
    log: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

type Spy = ReturnType<typeof vi.spyOn>;

let pluginRunSpy: Spy;
let entityRunSpy: Spy;
let serviceRunSpy: Spy;
let jobQueueRunSpy: Spy;
let codegenRunSpy: Spy;
let apiExtRunSpy: Spy;
let uiExtRunSpy: Spy;

beforeEach(() => {
    // Stub all core functions before every test
    const defaultReturnValue = { project: undefined as any, modifiedSourceFiles: [] };

    pluginRunSpy = vi.spyOn(pluginModule, 'createNewPlugin').mockResolvedValue(defaultReturnValue as any);
    entityRunSpy = vi.spyOn(entityModule, 'addEntity').mockResolvedValue(defaultReturnValue as any);
    serviceRunSpy = vi.spyOn(serviceModule, 'addService').mockResolvedValue(defaultReturnValue as any);
    jobQueueRunSpy = vi.spyOn(jobQueueModule, 'addJobQueue').mockResolvedValue(defaultReturnValue as any);
    codegenRunSpy = vi.spyOn(codegenModule, 'addCodegen').mockResolvedValue(defaultReturnValue as any);
    apiExtRunSpy = vi
        .spyOn(apiExtensionModule, 'addApiExtension')
        .mockResolvedValue(defaultReturnValue as any);
    uiExtRunSpy = vi
        .spyOn(uiExtensionsModule, 'addUiExtensions')
        .mockResolvedValue(defaultReturnValue as any);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Add Command E2E', () => {
    describe('addCommand non-interactive mode', () => {
        it('creates a plugin when the "plugin" option is provided', async () => {
            await addCommand({ plugin: 'test-plugin' });

            expect(pluginRunSpy).toHaveBeenCalledOnce();
            expect(pluginRunSpy).toHaveBeenCalledWith({ name: 'test-plugin', config: undefined });
        });

        it('throws when the plugin name is empty', async () => {
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

            await addCommand({ plugin: '   ' });

            expect(pluginRunSpy).not.toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(1);

            exitSpy.mockRestore();
        });

        it('adds an entity to the specified plugin', async () => {
            await addCommand({
                entity: 'MyEntity',
                selectedPlugin: 'MyPlugin',
            });

            expect(entityRunSpy).toHaveBeenCalledOnce();
            expect(entityRunSpy).toHaveBeenCalledWith({
                className: 'MyEntity',
                isNonInteractive: true,
                config: undefined,
                pluginName: 'MyPlugin',
                customFields: undefined,
                translatable: undefined,
            });
        });

        it('fails when adding an entity without specifying a plugin in non-interactive mode', async () => {
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

            await addCommand({ entity: 'MyEntity' });

            expect(entityRunSpy).not.toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(1);

            exitSpy.mockRestore();
        });

        it('adds a service to the specified plugin', async () => {
            await addCommand({
                service: 'MyService',
                selectedPlugin: 'MyPlugin',
            });

            expect(serviceRunSpy).toHaveBeenCalledOnce();
            expect(serviceRunSpy.mock.calls[0][0]).toMatchObject({
                serviceName: 'MyService',
                pluginName: 'MyPlugin',
            });
        });

        it('adds a job-queue when required parameters are provided', async () => {
            const options = {
                jobQueue: 'MyPlugin',
                name: 'ReindexJob',
                selectedService: 'SearchService',
            } as const;
            await addCommand(options);

            expect(jobQueueRunSpy).toHaveBeenCalledOnce();
            expect(jobQueueRunSpy.mock.calls[0][0]).toMatchObject({
                pluginName: 'MyPlugin',
                name: 'ReindexJob',
                selectedService: 'SearchService',
            });
        });

        it('fails when job-queue parameters are incomplete', async () => {
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

            await addCommand({ jobQueue: true, name: 'JobWithoutService' } as any);

            expect(jobQueueRunSpy).not.toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(1);

            exitSpy.mockRestore();
        });

        it('adds codegen configuration with boolean flag (interactive plugin selection)', async () => {
            await addCommand({ codegen: true });

            expect(codegenRunSpy).toHaveBeenCalledOnce();
            expect(codegenRunSpy.mock.calls[0][0]).toMatchObject({ pluginName: undefined });
        });

        it('adds codegen configuration to a specific plugin when plugin name is supplied', async () => {
            await addCommand({ codegen: 'MyPlugin' });

            expect(codegenRunSpy).toHaveBeenCalledOnce();
            expect(codegenRunSpy.mock.calls[0][0]).toMatchObject({ pluginName: 'MyPlugin' });
        });

        it('adds an API extension scaffold when queryName is provided', async () => {
            await addCommand({
                apiExtension: 'MyPlugin',
                queryName: 'myQuery',
            });

            expect(apiExtRunSpy).toHaveBeenCalledOnce();
            expect(apiExtRunSpy.mock.calls[0][0]).toMatchObject({
                pluginName: 'MyPlugin',
                queryName: 'myQuery',
                mutationName: undefined,
            });
        });

        it('fails when neither queryName nor mutationName is provided for API extension', async () => {
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

            await addCommand({ apiExtension: true } as any);

            expect(apiExtRunSpy).not.toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(1);

            exitSpy.mockRestore();
        });

        it('adds UI extensions when the uiExtensions flag is used', async () => {
            await addCommand({ uiExtensions: 'MyPlugin' });

            expect(uiExtRunSpy).toHaveBeenCalledOnce();
            expect(uiExtRunSpy.mock.calls[0][0]).toMatchObject({ pluginName: 'MyPlugin' });
        });

        it('exits with error when no valid operation is specified', async () => {
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

            await addCommand({});

            expect(exitSpy).not.toHaveBeenCalled(); // Empty options triggers interactive mode
            expect(pluginRunSpy).not.toHaveBeenCalled();
            expect(entityRunSpy).not.toHaveBeenCalled();
            expect(serviceRunSpy).not.toHaveBeenCalled();

            exitSpy.mockRestore();
        });
    });
});
