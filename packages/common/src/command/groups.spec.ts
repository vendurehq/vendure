import { describe, expect, it } from 'vitest';

import { defineCommand, defineCommandGroup } from './define';
import { applyCommandGroups, commandDeclarations } from './groups';
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
            'The command "cloud link" and the group "cloud" both declare the field "project"',
        );
    });

    it.each([
        ['an empty path', [{ ...cloudGroup, path: [] }], 'empty path'],
        [
            'a path another group has',
            [cloudGroup, { ...cloudGroup }],
            'Two command groups have the path "cloud"',
        ],
    ])('fails for a group with %s', (_, groups, message) => {
        expect(() =>
            applyCommandGroups([command(['cloud', 'deploy'], { commit: { type: 'string' } })], groups),
        ).toThrow(message);
    });

    it('validates synchronously when every part does, so a prompt can check an answer', async () => {
        const [deploy] = applyCommandGroups(
            [command(['cloud', 'deploy'], { commit: { type: 'string' } }, ['commit'])],
            [cloudGroup],
        );
        const result = (await deploy.schemas()).input['~standard'].validate({ commit: 'abc' });
        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ value: { environment: 'production', commit: 'abc' } });
    });

    it('fails for a group that holds no command', () => {
        expect(() =>
            applyCommandGroups([command(['doctor'], { check: { type: 'string' } })], [cloudGroup]),
        ).toThrow('The command group "cloud" holds no command');
    });
});

describe('nested groups', () => {
    const deploymentGroup = defineCommandGroup({
        path: ['cloud', 'deployment'],
        schemas: async () => ({
            input: objectSchema({ deployment: { type: 'string' } }, { required: ['deployment'] }),
        }),
        cli: { flags: { project: { short: '-P' } } },
    });

    it('applies the outermost group first, and lets an inner group override its CLI metadata', async () => {
        const [wait] = applyCommandGroups(
            [command(['cloud', 'deployment', 'wait'], { timeout: { type: 'number' } }, ['timeout'])],
            [deploymentGroup, cloudGroup],
        );
        const json = (await wait.schemas()).input['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
        expect(Object.keys(json.properties as object)).toEqual([
            'project',
            'environment',
            'deployment',
            'timeout',
        ]);
        expect(wait.cli?.flags?.project).toEqual({ short: '-P' });
    });

    it('collects the issues of every part in one result', async () => {
        const [wait] = applyCommandGroups(
            [command(['cloud', 'deployment', 'wait'], { timeout: { type: 'number' } }, ['timeout'])],
            [cloudGroup, deploymentGroup],
        );
        const result = await (await wait.schemas()).input['~standard'].validate({});
        expect(result.issues).toEqual([
            { message: 'Required', path: ['deployment'] },
            { message: 'Required', path: ['timeout'] },
        ]);
    });

    it('names both groups when two of them declare one field', async () => {
        const clashing = defineCommandGroup({
            path: ['cloud', 'deployment'],
            schemas: async () => ({ input: objectSchema({ environment: { type: 'string' } }) }),
        });
        const [wait] = applyCommandGroups(
            [command(['cloud', 'deployment', 'wait'], { timeout: { type: 'number' } })],
            [cloudGroup, clashing],
        );
        await expect(wait.schemas()).rejects.toThrow(
            'The group "cloud deployment" and the group "cloud" both declare the field "environment"',
        );
    });
});

/** A schema whose JSON Schema refers to a definition, as Zod writes for a registered schema. */
function schemaWithDefs(field: string, definition: Record<string, unknown>): StandardSchema {
    return {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: value => ({ value }),
            jsonSchema: {
                input: () => ({
                    type: 'object',
                    properties: { [field]: { $ref: '#/$defs/Region' } },
                    $defs: { Region: definition },
                }),
                output: () => ({ type: 'object', properties: {} }),
            },
        },
    };
}

describe('$defs', () => {
    const region = { type: 'string', enum: ['eu', 'us'] };

    it("keeps the definitions a group's JSON Schema refers to", async () => {
        const [deploy] = applyCommandGroups(
            [command(['cloud', 'deploy'], { commit: { type: 'string' } })],
            [
                defineCommandGroup({
                    path: ['cloud'],
                    schemas: async () => ({ input: schemaWithDefs('region', region) }),
                }),
            ],
        );
        const combined = (await deploy.schemas()).input['~standard'].jsonSchema.input({
            target: 'draft-2020-12',
        });
        expect(combined.$defs).toEqual({ Region: region });
    });

    it('fails when two parts define one name differently', async () => {
        const [deploy] = applyCommandGroups(
            [
                defineCommand({
                    path: ['cloud', 'deploy'],
                    description: 'Deploy',
                    behavior: 'mutating',
                    schemas: async () => ({ input: schemaWithDefs('target', { type: 'number' }) }),
                    run: async () => ({ run: async () => ({}) }),
                }),
            ],
            [
                defineCommandGroup({
                    path: ['cloud'],
                    schemas: async () => ({ input: schemaWithDefs('region', region) }),
                }),
            ],
        );
        const { input } = await deploy.schemas();
        expect(() => input['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toThrow(
            'define "$defs/Region" differently',
        );
    });
});

describe('a command at the path of its group', () => {
    it("gets none of the group's fields", async () => {
        const cloud = command(['cloud'], { verbose: { type: 'boolean' } });
        const [applied] = applyCommandGroups(
            [cloud, command(['cloud', 'deploy'], { commit: { type: 'string' } })],
            [cloudGroup],
        );
        expect(applied).toBe(cloud);
    });
});

describe('a part that validates asynchronously', () => {
    it("makes the combined result a Promise with every part's values", async () => {
        const asyncGroup = defineCommandGroup({
            path: ['cloud'],
            schemas: async () => {
                const sync = objectSchema({ project: { type: 'string' } });
                return {
                    input: {
                        '~standard': {
                            ...sync['~standard'],
                            validate: async (value: unknown) => sync['~standard'].validate(value),
                        },
                    },
                };
            },
        });
        const [deploy] = applyCommandGroups(
            [command(['cloud', 'deploy'], { commit: { type: 'string' } })],
            [asyncGroup],
        );
        const result = (await deploy.schemas()).input['~standard'].validate({
            project: 'shop',
            commit: 'abc',
        });
        expect(result).toBeInstanceOf(Promise);
        expect(await result).toEqual({ value: { project: 'shop', commit: 'abc' } });
    });
});

describe('commandDeclarations', () => {
    it("applies a declarations module's groups to its commands", async () => {
        const [deploy] = commandDeclarations({
            commands: [command(['cloud', 'deploy'], { commit: { type: 'string' } })],
            groups: [cloudGroup],
        });
        const json = (await deploy.schemas()).input['~standard'].jsonSchema.input({
            target: 'draft-2020-12',
        });
        expect(Object.keys(json.properties as object)).toContain('project');
    });

    it('reads a CommonJS module through its default export', () => {
        const doctor = command(['doctor'], { check: { type: 'string' } });
        expect(commandDeclarations({ default: { commands: [doctor] } })).toEqual([doctor]);
    });

    it('fails for a module that does not export its commands', () => {
        expect(() => commandDeclarations({ default: [] })).toThrow(
            'does not export its commands as "commands"',
        );
    });
});

describe('buildCommandManifest with groups', () => {
    it('writes the shared fields into each command a group holds', async () => {
        const manifest = await buildCommandManifest(
            '@vendure/cloud',
            '1.0.0',
            [command(['cloud', 'deploy'], { commit: { type: 'string' } }, ['commit'])],
            { groups: [cloudGroup] },
        );
        expect(Object.keys(manifest.commands[0].input.properties as object)).toEqual([
            'project',
            'environment',
            'commit',
        ]);
        expect(manifest.commands[0].cli.flags).toEqual({ project: { short: '-p' }, commit: { short: '-x' } });
    });

    it('accepts a field named project, which the host no longer reserves', async () => {
        const manifest = await buildCommandManifest('acme', '1.0.0', [
            command(['acme'], { project: { type: 'string' } }),
        ]);
        expect(Object.keys(manifest.commands[0].input.properties as object)).toEqual(['project']);
    });
});
