import { isCancel, select } from '@clack/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCoreCommand } from '../../command-host/run-core-command.js';

import { addCommand, commandForFlags } from './add.js';
import { addCommandDef } from './command.js';
import { addPlatform } from './platform/add-platform.js';

vi.mock('@clack/prompts', () => ({
    cancel: vi.fn(),
    intro: vi.fn(),
    isCancel: vi.fn(() => false),
    log: { error: vi.fn() },
    outro: vi.fn(),
    select: vi.fn(),
}));

vi.mock('../../utilities/utils.js', () => ({
    abortIfNonInteractive: vi.fn(() => false),
    withInteractiveTimeout: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../command-host/run-core-command.js', () => ({
    runCoreCommand: vi.fn(() => Promise.resolve({ exitCode: 0, envelope: { status: 'ok' } })),
}));

vi.mock('./platform/add-platform.js', () => ({
    addPlatform: vi.fn(() => Promise.resolve({ project: undefined, modifiedSourceFiles: [] })),
}));

describe('commandForFlags()', () => {
    it.each([
        [{ plugin: 'reviews', config: './c.ts' }, ['add', 'plugin'], { name: 'reviews', config: './c.ts' }],
        [
            { entity: 'Review', selectedPlugin: 'ReviewsPlugin', translatable: true },
            ['add', 'entity'],
            { name: 'Review', plugin: 'ReviewsPlugin', customFields: undefined, translatable: true },
        ],
        [
            { service: 'ReviewService', selectedPlugin: 'ReviewsPlugin', selectedEntity: 'Review' },
            ['add', 'service'],
            { name: 'ReviewService', plugin: 'ReviewsPlugin', entity: 'Review' },
        ],
        [
            { jobQueue: 'ReviewsPlugin', name: 'indexing', selectedService: 'ReviewService' },
            ['add', 'job-queue'],
            { plugin: 'ReviewsPlugin', service: 'ReviewService', name: 'indexing' },
        ],
        [
            { apiExtension: true, selectedService: 'ReviewService', queryName: 'reviews' },
            ['add', 'api-extension'],
            { plugin: undefined, service: 'ReviewService', queryName: 'reviews', mutationName: undefined },
        ],
        [{ dashboard: 'ReviewsPlugin' }, ['add', 'dashboard'], { plugin: 'ReviewsPlugin' }],
    ])('maps %j to a vendure add subcommand', (options, path, input) => {
        expect(commandForFlags(options)).toEqual({ path, input });
    });

    // The older flags never checked names, and the CLI guide shows `vendure add -p MyPlugin`.
    it.each([
        [{ plugin: 'MyPlugin' }, 'my-plugin'],
        [{ plugin: 'reviews' }, 'reviews'],
    ])('converts the plugin name of %j to the form `add plugin` takes', (options, name) => {
        expect(commandForFlags(options)?.input.name).toBe(name);
    });

    it.each([
        ['myEntity', 'MyEntity'],
        ['product-review', 'ProductReview'],
        // A name that fits is kept as typed, acronyms included.
        ['GraphQLService', 'GraphQLService'],
    ])('converts the class name %j to PascalCase only when it does not fit', (typed, name) => {
        expect(commandForFlags({ entity: typed, selectedPlugin: 'P' })?.input.name).toBe(name);
        expect(commandForFlags({ service: typed, selectedPlugin: 'P' })?.input.name).toBe(name);
    });

    // `vendure add --config x` used to fail with "No valid add operation specified".
    it('maps no subcommand for --config alone', () => {
        expect(commandForFlags({ config: './c.ts' })).toBeUndefined();
    });
});

describe('addCommand()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('runs the subcommand of a flag through the host and returns its exit code', async () => {
        vi.mocked(runCoreCommand).mockResolvedValueOnce({
            exitCode: 1,
            envelope: { status: 'error' },
        } as any);

        await expect(addCommandDef.action({ dashboard: 'ReviewsPlugin' })).resolves.toBe(1);

        expect(runCoreCommand).toHaveBeenCalledWith(['add', 'dashboard'], { plugin: 'ReviewsPlugin' });
        expect(select).not.toHaveBeenCalled();
    });

    it('runs the Platform flow for --platform', async () => {
        await expect(addCommand({ platform: true })).resolves.toBe(0);

        expect(addPlatform).toHaveBeenCalled();
        expect(runCoreCommand).not.toHaveBeenCalled();
    });

    it('offers the Platform entry first, then the subcommands', async () => {
        vi.mocked(select).mockResolvedValueOnce('add-platform');

        await addCommand({});

        const { options } = vi.mocked(select).mock.calls[0][0];
        expect(options.map(option => option.value)).toEqual([
            'add-platform',
            'add-plugin',
            'add-entity',
            'add-service',
            'add-api-extension',
            'add-job-queue',
            'add-dashboard',
            'add-codegen',
        ]);
    });

    it('shows the menu for --config alone, and passes the config to a new plugin', async () => {
        vi.mocked(select).mockResolvedValueOnce('add-plugin').mockResolvedValueOnce('no');
        vi.mocked(runCoreCommand).mockResolvedValueOnce({
            exitCode: 0,
            envelope: { status: 'ok', output: { plugin: 'ReviewsPlugin' } },
        } as any);

        await expect(addCommand({ config: './c.ts' })).resolves.toBe(0);

        expect(runCoreCommand).toHaveBeenCalledWith(['add', 'plugin'], { config: './c.ts' });
    });

    it('runs the chosen entry through the host, which asks for the rest', async () => {
        vi.mocked(select).mockResolvedValueOnce('add-job-queue');

        await expect(addCommand({})).resolves.toBe(0);

        expect(runCoreCommand).toHaveBeenCalledWith(['add', 'job-queue'], {});
    });

    it('adds features to a new plugin until the person is done', async () => {
        vi.mocked(select)
            .mockResolvedValueOnce('add-plugin')
            .mockResolvedValueOnce('add-entity')
            .mockResolvedValueOnce('add-dashboard')
            .mockResolvedValueOnce('no');
        vi.mocked(runCoreCommand).mockResolvedValueOnce({
            exitCode: 0,
            envelope: { status: 'ok', output: { plugin: 'ReviewsPlugin' } },
        } as any);

        await expect(addCommand({})).resolves.toBe(0);

        expect(vi.mocked(runCoreCommand).mock.calls.map(call => call[0].join(' '))).toEqual([
            'add plugin',
            'add entity',
            'add dashboard',
        ]);
        expect(runCoreCommand).toHaveBeenLastCalledWith(['add', 'dashboard'], { plugin: 'ReviewsPlugin' });
    });

    it('stops adding features when the person cancels', async () => {
        vi.mocked(select).mockResolvedValueOnce('add-plugin').mockResolvedValueOnce(Symbol('cancel'));
        vi.mocked(isCancel).mockImplementation(value => typeof value === 'symbol');
        vi.mocked(runCoreCommand).mockResolvedValueOnce({
            exitCode: 0,
            envelope: { status: 'ok', output: { plugin: 'ReviewsPlugin' } },
        } as any);

        await expect(addCommand({})).resolves.toBe(0);

        expect(runCoreCommand).toHaveBeenCalledTimes(1);
        vi.mocked(isCancel).mockImplementation(() => false);
    });

    it('ends with "cancelled" and exit code 0 when the person cancels a prompt of the command', async () => {
        const { cancel } = await import('@clack/prompts');
        vi.mocked(select).mockResolvedValueOnce('add-entity');
        vi.mocked(runCoreCommand).mockResolvedValueOnce({
            exitCode: 130,
            envelope: { status: 'error', error: { code: 'cancelled' } },
        } as any);

        await expect(addCommand({})).resolves.toBe(0);

        expect(cancel).toHaveBeenCalledWith('Add feature cancelled.');
    });

    it('offers no features when the plugin could not be created', async () => {
        vi.mocked(select).mockResolvedValueOnce('add-plugin');
        vi.mocked(runCoreCommand).mockResolvedValueOnce({
            exitCode: 1,
            envelope: { status: 'error' },
        } as any);

        await expect(addCommand({})).resolves.toBe(1);

        expect(select).toHaveBeenCalledTimes(1);
    });

    it('has no --codegen flag, which `vendure add codegen` replaces', () => {
        expect(addCommandDef.options?.map(option => option.long)).not.toContainEqual(
            expect.stringMatching(/^--codegen\b/),
        );
    });
});
