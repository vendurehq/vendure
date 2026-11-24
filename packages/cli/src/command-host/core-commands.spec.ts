import { buildCommandManifest, mergeManifests } from '@vendure/common/lib/command/manifest';
import { describe, expect, it } from 'vitest';

import { coreCommandDefinitions } from './core-commands.js';
import { kebab } from './naming.js';

describe('core command definitions', () => {
    it('build into a manifest the host accepts', async () => {
        const manifest = await buildCommandManifest('@vendure/cli', '0.0.0', coreCommandDefinitions);
        const merged = mergeManifests([manifest]);
        expect(merged.map(c => c.path.join(' ')).sort()).toEqual([
            'add api-extension',
            'add codegen',
            'add dashboard',
            'add entity',
            'add job-queue',
            'add plugin',
            'add service',
            'commands',
            'devserver logs',
            'devserver start',
            'devserver status',
            'devserver stop',
            'devserver wait',
            'doctor',
            'explain',
            'guide',
            'mcp install',
            'migrate generate',
            'migrate revert',
            'migrate run',
        ]);
    });

    it.each(coreCommandDefinitions.map(def => [def.path.join(' '), def] as const))(
        '%s loads its modules',
        async (_name, def) => {
            expect((await def.schemas()).input['~standard']).toBeDefined();
            expect(typeof (await def.run()).run).toBe('function');
            if (def.plan) {
                expect(typeof (await def.plan()).plan).toBe('function');
            }
            if (def.render) {
                expect(typeof (await def.render()).render).toBe('function');
            }
        },
    );

    it.each(coreCommandDefinitions.map(def => [def.path.join(' '), def] as const))(
        '%s has examples that start with its own path and use flags it has',
        async (_name, def) => {
            const manifest = (await buildCommandManifest('@vendure/cli', '0.0.0', [def])).commands[0];
            const known = new Set([
                ...Object.keys((manifest.input.properties as object) ?? {}).map(kebab),
                'json',
                'input',
            ]);
            for (const example of def.examples ?? []) {
                const words = example.split(/\s+/);
                expect(words.slice(0, 1 + def.path.length)).toEqual(['vendure', ...def.path]);
                for (const word of words.filter(w => w.startsWith('--'))) {
                    expect(known.has(word.slice(2))).toBe(true);
                }
            }
        },
    );

    it('has a plan() on every command that declares consents', () => {
        for (const def of coreCommandDefinitions) {
            if (def.consents) {
                expect(def.plan).toBeDefined();
            }
        }
    });
});
