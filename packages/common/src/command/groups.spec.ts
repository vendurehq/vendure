import { describe, expect, it } from 'vitest';

import { defineCommand, defineCommandGroup } from './define';
import { applyCommandGroups } from './groups';
import { buildCommandManifest } from './manifest/build';
import { StandardSchema } from './types';

/**
 * An object schema that implements only the Standard Schema interface, as Zod v4 does: it requires
 * the `required` fields, applies `defaults`, and drops fields it does not declare.
 */
function objectSchema(
    properties: Record<string, { type: string }>,
    { required = [], defaults = {} }: { required?: string[]; defaults?: Record<string, unknown> } = {},
): StandardSchema {
    const json = { type: 'object', properties, required };
    return {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: value => {
                const input = value as Record<string, unknown>;
                const missing = required.filter(field => input[field] === undefined);
                if (missing.length) {
                    return { issues: missing.map(field => ({ message: 'Required', path: [field] })) };
                }
                const known = Object.fromEntries(
                    Object.entries(input).filter(([field]) => field in properties),
                );
                return { value: { ...defaults, ...known } };
            },
            jsonSchema: { input: () => json, output: () => json },
        },
    };
}

const cloudGroup = defineCommandGroup({
    path: ['cloud'],
    description: 'Vendure Cloud commands',
    schemas: async () => ({
        input: objectSchema(
            { project: { type: 'string' }, environment: { type: 'string' } },
            { defaults: { environment: 'production' } },
        ),
    }),
    cli: { flags: { project: { short: '-p' } } },
});

function command(path: string[], properties: Record<string, { type: string }>, required: string[] = []) {
    return defineCommand({
        path,
        description: path.join(' '),
        behavior: 'readonly',
        schemas: async () => ({ input: objectSchema(properties, { required }) }),
        cli: { flags: { [Object.keys(properties)[0]]: { short: '-x' } } },
        run: async () => ({ run: async () => ({}) }),
    });
}

describe('applyCommandGroups', () => {
    it('validates each part with its own schema and hands run() one input object', async () => {
        const [deploy] = applyCommandGroups(
            [command(['cloud', 'deploy'], { commit: { type: 'string' } }, ['commit'])],
            [cloudGroup],
        );
        const { input } = await deploy.schemas();

        const ok = await input['~standard'].validate({ commit: 'abc', project: 'shop', stray: 1 });
        expect(ok).toEqual({ value: { project: 'shop', environment: 'production', commit: 'abc' } });

        const missing = await input['~standard'].validate({ project: 'shop' });
        expect(missing.issues).toEqual([{ message: 'Required', path: ['commit'] }]);
    });

    it("adds the shared fields to the command's JSON Schema and CLI metadata", async () => {
        const [deploy] = applyCommandGroups(
            [command(['cloud', 'deploy'], { commit: { type: 'string' } }, ['commit'])],
            [cloudGroup],
        );
        const json = (await deploy.schemas()).input['~standard'].jsonSchema.input({
            target: 'draft-2020-12',
        });
        expect(Object.keys(json.properties as object)).toEqual(['project', 'environment', 'commit']);
        expect(json.required).toEqual(['commit']);
        expect(deploy.cli?.flags).toEqual({ project: { short: '-p' }, commit: { short: '-x' } });
    });

    it('leaves a command outside every group as it is', () => {
        const doctor = command(['doctor'], { check: { type: 'string' } });
        const applied = applyCommandGroups(
            [doctor, command(['cloud', 'deploy'], { commit: { type: 'string' } })],
            [cloudGroup],
        );
        expect(applied[0]).toBe(doctor);
    });

    it('fails for a field that a group and its command both declare', async () => {
        const [clash] = applyCommandGroups(
            [command(['cloud', 'link'], { project: { type: 'string' } })],
            [cloudGroup],
        );
        await expect(clash.schemas()).rejects.toThrow(
            '"cloud link" declares the field "project", which a group of the command already declares',
        );
    });

    it('fails for a group that holds no command', () => {
        expect(() =>
            applyCommandGroups([command(['doctor'], { check: { type: 'string' } })], [cloudGroup]),
        ).toThrow('The command group "cloud" holds no command');
    });
});

describe('buildCommandManifest with groups', () => {
    it('lists the groups and writes the shared fields into each command they hold', async () => {
        const manifest = await buildCommandManifest(
            '@vendure/cloud',
            '1.0.0',
            [command(['cloud', 'deploy'], { commit: { type: 'string' } }, ['commit'])],
            { groups: [cloudGroup] },
        );
        expect(manifest.groups).toEqual([
            {
                path: ['cloud'],
                description: 'Vendure Cloud commands',
                input: {
                    type: 'object',
                    properties: { project: { type: 'string' }, environment: { type: 'string' } },
                    required: [],
                },
            },
        ]);
        expect(Object.keys(manifest.commands[0].input.properties as object)).toEqual([
            'project',
            'environment',
            'commit',
        ]);
        expect(manifest.commands[0].cli.flags).toEqual({ project: { short: '-p' }, commit: { short: '-x' } });
    });

    it('accepts a field named project, which the host no longer reserves', async () => {
        await expect(
            buildCommandManifest('acme', '1.0.0', [command(['acme'], { project: { type: 'string' } })]),
        ).resolves.toBeDefined();
    });
});
