import { buildCommandManifest } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findMismatch } from './commander-adapter.js';
import { mergeProjectManifests } from './manifest.js';
import { testCommand } from './test-command.js';

/** A Standard Schema object schema written out in a module, so the module imports nothing. */
const SCHEMA = `
function objectSchema(properties) {
    const json = { type: 'object', properties };
    return {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: value => ({
                value: Object.fromEntries(Object.entries(value ?? {}).filter(([field]) => field in properties)),
            }),
            jsonSchema: { input: () => json, output: () => json },
        },
    };
}
`;

const TOOLS = `${SCHEMA}
export const commands = [
    {
        path: ['tools', 'sync'],
        description: 'Sync',
        behavior: 'readonly',
        cli: { fields: { trace: { internal: true } } },
        schemas: async () => ({ input: objectSchema({ target: { type: 'string' }, trace: { type: 'string' } }) }),
        run: async () => ({ run: async input => ({ ran: input }) }),
    },
];
`;

const CLOUD = `${SCHEMA}
export const commands = [];
export const extensions = [
    {
        path: ['tools', 'sync'],
        schemas: async () => ({ input: objectSchema({ trace: { type: 'string' } }) }),
        run: async () => ({ run: async (_input, _ctx, next) => next() }),
    },
];
`;

describe('loadDefinitions with an extension that clashes with an internal field', () => {
    let dir: string | undefined;

    afterEach(() => {
        vi.restoreAllMocks();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('leaves the extension out with a warning, and the command keeps working', async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-extension-clash-'));
        const toolsFile = path.join(dir, 'tools.mjs');
        const cloudFile = path.join(dir, 'cloud.mjs');
        fs.writeFileSync(toolsFile, TOOLS);
        fs.writeFileSync(cloudFile, CLOUD);
        const tools = await import(pathToFileURL(toolsFile).href);
        const cloud = await import(pathToFileURL(cloudFile).href);
        const core = await buildCommandManifest('@vendure/cli', '4.0.0', []);
        const { commands, refused, loadDefinitions } = mergeProjectManifests(core, [
            {
                packageName: '@acme/tools',
                manifest: await buildCommandManifest('@acme/tools', '1.0.0', tools.commands),
                definitionsPath: toolsFile,
                scope: 'project',
            },
            {
                packageName: '@acme/cloud',
                manifest: await buildCommandManifest('@acme/cloud', '1.0.0', [], {
                    extensions: cloud.extensions,
                }),
                definitionsPath: cloudFile,
                scope: 'project',
            },
        ]);
        // The internal field is not in the manifest, so the merge could not see the clash.
        expect(refused).toEqual([]);
        const sync = commands.find(command => command.path.join(' ') === 'tools sync')!;
        expect(sync.extendedBy).toEqual([{ package: '@acme/cloud', fields: ['trace'] }]);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const [definition] = await loadDefinitions('@acme/tools');

        expect(stderr.mock.calls.join('')).toContain('[plugin.extension-clash]');
        expect(sync.extendedBy).toEqual([]);
        expect(await findMismatch(definition, sync)).toBeUndefined();
        const result = await testCommand(definition, { target: 'eu', trace: 'from the caller' });
        expect(result.envelope.output).toEqual({ ran: { target: 'eu' } });
    });
});
