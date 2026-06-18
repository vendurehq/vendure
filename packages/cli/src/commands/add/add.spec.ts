/**
 * Unit tests for the add command
 * These tests ensure both interactive and non-interactive modes work correctly
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addCommand } from './add';
import * as apiExtensionModule from './api-extension/add-api-extension';
import * as codegenModule from './codegen/add-codegen';
import * as entityModule from './entity/add-entity';
import * as jobQueueModule from './job-queue/add-job-queue';
import * as pluginModule from './plugin/create-new-plugin';
import * as serviceModule from './service/add-service';
import * as uiExtensionsModule from './ui-extensions/add-ui-extensions';

// Mock all the core functions
vi.mock('./plugin/create-new-plugin', () => ({
    createNewPlugin: vi.fn(),
}));
vi.mock('./entity/add-entity', () => ({
    addEntity: vi.fn(),
}));
vi.mock('./service/add-service', () => ({
    addService: vi.fn(),
}));
vi.mock('./job-queue/add-job-queue', () => ({
    addJobQueue: vi.fn(),
}));
vi.mock('./codegen/add-codegen', () => ({
    addCodegen: vi.fn(),
}));
vi.mock('./api-extension/add-api-extension', () => ({
    addApiExtension: vi.fn(),
}));
vi.mock('./ui-extensions/add-ui-extensions', () => ({
    addUiExtensions: vi.fn(),
}));

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

describe('add command', () => {
    const mockCreateNewPlugin = vi.mocked(pluginModule.createNewPlugin);
    const mockAddEntity = vi.mocked(entityModule.addEntity);
    const mockAddService = vi.mocked(serviceModule.addService);
    const mockAddJobQueue = vi.mocked(jobQueueModule.addJobQueue);
    const mockAddCodegen = vi.mocked(codegenModule.addCodegen);
    const mockAddApiExtension = vi.mocked(apiExtensionModule.addApiExtension);
    const mockAddUiExtensions = vi.mocked(uiExtensionsModule.addUiExtensions);

    beforeEach(() => {
        vi.clearAllMocks();
        // Default to successful operation (all functions return CliCommandReturnVal)
        const defaultReturnValue = {
            project: {} as any,
            modifiedSourceFiles: [],
        };
        mockCreateNewPlugin.mockResolvedValue(defaultReturnValue as any);
        mockAddEntity.mockResolvedValue(defaultReturnValue as any);
        mockAddService.mockResolvedValue(defaultReturnValue as any);
        mockAddJobQueue.mockResolvedValue(defaultReturnValue as any);
        mockAddCodegen.mockResolvedValue(defaultReturnValue as any);
        mockAddApiExtension.mockResolvedValue(defaultReturnValue as any);
        mockAddUiExtensions.mockResolvedValue(defaultReturnValue as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('non-interactive mode detection', () => {
        it('detects non-interactive mode when plugin option is provided', async () => {
            await addCommand({ plugin: 'test-plugin' });

            expect(mockCreateNewPlugin).toHaveBeenCalledWith({ name: 'test-plugin', config: undefined });
        });

        it('detects non-interactive mode when entity option is provided', async () => {
            await addCommand({ entity: 'TestEntity', selectedPlugin: 'TestPlugin' });

            expect(mockAddEntity).toHaveBeenCalledWith({
                className: 'TestEntity',
                isNonInteractive: true,
                config: undefined,
                pluginName: 'TestPlugin',
                customFields: undefined,
                translatable: undefined,
            });
        });

        it('detects non-interactive mode when service option is provided', async () => {
            await addCommand({ service: 'TestService', selectedPlugin: 'TestPlugin' });

            expect(mockAddService).toHaveBeenCalledWith({
                serviceName: 'TestService',
                isNonInteractive: true,
                config: undefined,
                pluginName: 'TestPlugin',
                serviceType: 'basic',
                selectedEntityName: undefined,
            });
        });

        it('detects non-interactive mode when jobQueue option is provided', async () => {
            await addCommand({
                jobQueue: 'TestPlugin',
                name: 'TestJob',
                selectedService: 'TestService',
            });

            expect(mockAddJobQueue).toHaveBeenCalledWith({
                isNonInteractive: true,
                config: undefined,
                pluginName: 'TestPlugin',
                name: 'TestJob',
                selectedService: 'TestService',
            });
        });

        it('detects non-interactive mode when codegen option is provided', async () => {
            await addCommand({ codegen: true });

            expect(mockAddCodegen).toHaveBeenCalledWith({
                isNonInteractive: true,
                config: undefined,
                pluginName: undefined,
            });
        });

        it('detects non-interactive mode when apiExtension option is provided', async () => {
            await addCommand({ apiExtension: 'TestPlugin', queryName: 'testQuery' });

            expect(mockAddApiExtension).toHaveBeenCalledWith({
                isNonInteractive: true,
                config: undefined,
                pluginName: 'TestPlugin',
                queryName: 'testQuery',
                mutationName: undefined,
                selectedService: undefined,
            });
        });

        it('detects non-interactive mode when uiExtensions option is provided', async () => {
            await addCommand({ uiExtensions: 'TestPlugin' });

            expect(mockAddUiExtensions).toHaveBeenCalledWith({
                isNonInteractive: true,
                config: undefined,
                pluginName: 'TestPlugin',
            });
        });

        it('detects non-interactive mode when config option is provided along with other options', async () => {
            await addCommand({ plugin: 'test-plugin', config: './custom-config.ts' });

            expect(mockCreateNewPlugin).toHaveBeenCalledWith({
                name: 'test-plugin',
                config: './custom-config.ts',
            });
        });

        it('treats false values as not triggering non-interactive mode', async () => {
            await addCommand({ codegen: false, uiExtensions: false } as any);

            // Should NOT call any add functions (goes to interactive mode instead)
            expect(mockCreateNewPlugin).not.toHaveBeenCalled();
            expect(mockAddCodegen).not.toHaveBeenCalled();
            expect(mockAddUiExtensions).not.toHaveBeenCalled();
        });
    });

    describe('non-interactive mode - success cases', () => {
        it('logs success message when operation succeeds', async () => {
            const { log } = await import('@clack/prompts');

            await addCommand({ plugin: 'test-plugin' });

            expect(log.success).toHaveBeenCalledWith('Plugin "test-plugin" created successfully');
        });

        it('passes through all provided options correctly', async () => {
            const options = {
                entity: 'MyEntity',
                selectedPlugin: 'MyPlugin',
                customFields: true,
                translatable: true,
                config: './config.ts',
            };

            await addCommand(options);

            expect(mockAddEntity).toHaveBeenCalledWith({
                className: 'MyEntity',
                isNonInteractive: true,
                config: './config.ts',
                pluginName: 'MyPlugin',
                customFields: true,
                translatable: true,
            });
        });
    });

    describe('non-interactive mode - error cases', () => {
        it('logs error and exits when validation fails', async () => {
            const { log } = await import('@clack/prompts');
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

            await addCommand({ plugin: '   ' }); // Empty plugin name

            expect(log.error).toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(mockCreateNewPlugin).not.toHaveBeenCalled();

            exitSpy.mockRestore();
        });

        it('logs error with stack trace when exception is thrown', async () => {
            const { log } = await import('@clack/prompts');
            const error = new Error('Plugin name is required');
            error.stack = 'Error: Plugin name is required\n    at someFunction';
            mockCreateNewPlugin.mockRejectedValue(error);

            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

            await addCommand({ plugin: 'test' });

            expect(log.error).toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(1);

            exitSpy.mockRestore();
        });
    });

    describe('interactive mode detection', () => {
        it('enters interactive mode when no options are provided', async () => {
            const { intro } = await import('@clack/prompts');

            await addCommand();

            // Should call intro to start interactive session
            expect(intro).toHaveBeenCalled();
            // Should NOT call any add functions
            expect(mockCreateNewPlugin).not.toHaveBeenCalled();
            expect(mockAddEntity).not.toHaveBeenCalled();
        });

        it('enters interactive mode when options object is empty', async () => {
            const { intro } = await import('@clack/prompts');

            await addCommand({});

            expect(intro).toHaveBeenCalled();
            expect(mockCreateNewPlugin).not.toHaveBeenCalled();
        });

        it('enters non-interactive mode when config is provided with operation flag', async () => {
            // Config combined with an operation triggers non-interactive mode
            await addCommand({ config: './config.ts', plugin: 'TestPlugin' });

            expect(mockCreateNewPlugin).toHaveBeenCalledWith({
                name: 'TestPlugin',
                config: './config.ts',
            });
        });
    });

    describe('option mapping consistency', () => {
        it('preserves all option properties when routing to functions', async () => {
            const complexOptions = {
                service: 'ComplexService',
                selectedPlugin: 'ComplexPlugin',
                type: 'entity',
                selectedEntity: 'Product',
                config: './custom.config.ts',
            };

            await addCommand(complexOptions);

            expect(mockAddService).toHaveBeenCalledWith({
                serviceName: 'ComplexService',
                isNonInteractive: true,
                config: './custom.config.ts',
                pluginName: 'ComplexPlugin',
                serviceType: 'entity',
                selectedEntityName: 'Product',
            });
        });

        it('calls functions with correct parameter mapping for complex options', async () => {
            await addCommand({
                jobQueue: true,
                name: 'MyJob',
                selectedService: 'MyService',
                config: './config.ts',
            });

            expect(mockAddJobQueue).toHaveBeenCalledWith({
                isNonInteractive: true,
                config: './config.ts',
                pluginName: undefined,
                name: 'MyJob',
                selectedService: 'MyService',
            });
        });
    });
});
