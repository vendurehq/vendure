import { describe, expect, it } from 'vitest';

import { defineCommand, defineCommandExtension, defineError, fail, failed, incomplete } from './define';
import { applyCommandExtensions, extensionDeclarations } from './groups';
import { CommandContext, CommandEvent, StandardSchema } from './types';

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
                const input = (value ?? {}) as Record<string, unknown>;
                const missing = required.filter(field => input[field] === undefined);
                if (missing.length) {
                    return {
                        issues: missing.map(field => ({ message: `${field} is required`, path: [field] })),
                    };
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

function context(events: CommandEvent[] = [], signal = new AbortController().signal): CommandContext {
    return {
        cwd: '/project',
        signal,
        mcp: false,
        notice: () => undefined,
        progress: message => events.push({ vendure: 'event', type: 'progress', message }),
        output: text => events.push({ vendure: 'event', type: 'output', stream: 'stdout', text }),
        event: (type, data) => events.push({ ...data, vendure: 'event', type }),
        spawn: () => Promise.reject(new Error('no processes')),
        consent: async () => true as const,
    };
}

const seen: Array<Record<string, unknown>> = [];

const deploy = defineCommand({
    path: ['acme', 'deploy'],
    description: 'Deploy',
    behavior: 'mutating',
    consents: { overwrite: 'Overwrite it' },
    errors: [defineError({ code: 'acme.down', exit: 1, message: () => 'down' })],
    cli: { fields: { trace: { internal: true } } },
    schemas: async () => ({
        input: objectSchema(
            { environment: { type: 'string' }, trace: { type: 'string' } },
            { defaults: { environment: 'staging' } },
        ),
        output: objectSchema({ deployed: { type: 'string' } }, { required: ['deployed'] }),
    }),
    run: async () => ({
        run: async (input: Record<string, unknown>, ctx) => {
            seen.push(input);
            ctx.progress('deploying');
            return { deployed: String(input.environment) };
        },
    }),
});

const notLinked = defineError({ code: 'cloud.not-linked', exit: 1, message: () => 'not linked' });

function cloudExtension(run: Parameters<typeof defineCommandExtension>[0]['run']) {
    return defineCommandExtension({
        path: ['acme', 'deploy'],
        consents: { deployPreview: 'Deploy a preview' },
        errors: [notLinked],
        cli: { flags: { project: { short: '-p' } } },
        schemas: async () => ({
            input: objectSchema({ project: { type: 'string' } }, { required: ['project'] }),
            output: objectSchema({ previewUrl: { type: 'string' } }),
        }),
        run,
    });
}

async function runExtended(
    extensions: Array<ReturnType<typeof defineCommandExtension>>,
    rawInput: Record<string, unknown>,
    ctx = context(),
) {
    const extended = applyCommandExtensions(deploy, extensions);
    const schemas = await extended.schemas();
    const validation = await schemas.input['~standard'].validate(rawInput);
    if (validation.issues) {
        return { issues: validation.issues };
    }
    const { run } = await extended.run();
    return { result: await run(validation.value, ctx) };
}

describe('applyCommandExtensions', () => {
    it('merges the consents, errors and CLI metadata, and validates each part of the input', async () => {
        const extended = applyCommandExtensions(deploy, [
            cloudExtension(async () => ({ run: async (_input, _ctx, next) => next() })),
        ]);

        expect(Object.keys(extended.consents ?? {})).toEqual(['overwrite', 'deployPreview']);
        expect(extended.errors?.map(error => error.code)).toEqual(['acme.down', 'cloud.not-linked']);
        expect(extended.cli?.flags?.project).toEqual({ short: '-p' });

        const missing = await runExtended([cloudExtension(async () => ({ run: async () => ({}) }))], {});
        expect(missing.issues).toEqual([{ message: 'project is required', path: ['project'] }]);
    });

    it('gives the extension the full input, and the command only its own fields', async () => {
        seen.length = 0;
        let extensionInput: Record<string, unknown> | undefined;
        const { result } = await runExtended(
            [
                cloudExtension(async () => ({
                    run: async (input, _ctx, next) => {
                        extensionInput = input;
                        // The extension's own field is never passed on, even when it is given.
                        return next({ ...input, environment: 'production' });
                    },
                })),
            ],
            { project: 'storefront', environment: 'staging' },
        );

        expect(extensionInput).toEqual({ project: 'storefront', environment: 'staging' });
        expect(seen).toEqual([{ environment: 'production' }]);
        expect(result).toEqual({ deployed: 'production' });
    });

    it('lets an extension set an internal field of the command through next()', async () => {
        seen.length = 0;
        await runExtended(
            [cloudExtension(async () => ({ run: async (_input, _ctx, next) => next({ trace: 'cloud' }) }))],
            { project: 'storefront' },
        );

        // The command's schema validated what next() was given, and applied its default.
        expect(seen).toEqual([{ environment: 'staging', trace: 'cloud' }]);
    });

    it('adds the output of the extension, and checks it against both schemas', async () => {
        const { result } = await runExtended(
            [
                cloudExtension(async () => ({
                    run: async (_input, _ctx, next) => {
                        const output = (await next()) as Record<string, unknown>;
                        return { ...output, previewUrl: 'https://preview' };
                    },
                })),
            ],
            { project: 'storefront' },
        );
        expect(result).toEqual({ deployed: 'staging', previewUrl: 'https://preview' });

        // Without calling next(), the output must still be one the command could return.
        await expect(
            runExtended([cloudExtension(async () => ({ run: async () => ({ previewUrl: 'x' }) }))], {
                project: 'storefront',
            }),
        ).rejects.toThrow('deployed is required');
        expect(
            (
                await runExtended(
                    [cloudExtension(async () => ({ run: async () => ({ deployed: 'nowhere' }) }))],
                    {
                        project: 'storefront',
                    },
                )
            ).result,
        ).toEqual({ deployed: 'nowhere' });
    });

    it('resolves next() to every kind of result as a value, and may call it more than once', async () => {
        const outcomes = [
            { deployed: 'staging' },
            incomplete([{ kind: 'input', field: 'environment', description: 'Where' }]),
            failed({ deployed: 'half' }),
            fail(deploy.errors![0], {}),
        ];
        const inner = defineCommand({
            ...deploy,
            run: async () => {
                let call = 0;
                return { run: async () => outcomes[call++] as any };
            },
        });
        const results: unknown[] = [];
        const extended = applyCommandExtensions(inner, [
            cloudExtension(async () => ({
                run: async (_input, _ctx, next) => {
                    for (let attempt = 0; attempt < outcomes.length; attempt++) {
                        results.push(await next());
                    }
                    // An ok output may be turned into a failed one.
                    return failed({ deployed: 'staging' });
                },
            })),
        ]);
        const { run } = await extended.run();

        const result = await run({ project: 'storefront', environment: 'staging' }, context());

        expect(results).toEqual(outcomes);
        expect(result).toEqual(failed({ deployed: 'staging' }));
    });

    it("returns an extension's fail() with its declared error as the result", async () => {
        const { result } = await runExtended(
            [cloudExtension(async () => ({ run: async () => fail(notLinked, {}) }))],
            { project: 'storefront' },
        );
        expect(result).toEqual(fail(notLinked, {}));
    });

    it("stops the inner run when next()'s signal fires, and resolves once it has returned", async () => {
        let innerStopped = false;
        const waiting = defineCommand({
            ...deploy,
            run: async () => ({
                run: async (_input: unknown, ctx: CommandContext) => {
                    await new Promise<void>(resolve => ctx.signal.addEventListener('abort', () => resolve()));
                    innerStopped = true;
                    return { deployed: 'stopped' };
                },
            }),
        });
        const outer = new AbortController();
        const extended = applyCommandExtensions(waiting, [
            cloudExtension(async () => ({
                run: async (_input, ctx, next) => {
                    const stop = new AbortController();
                    setTimeout(() => stop.abort(), 10);
                    const result = await next(undefined, { signal: stop.signal });
                    // The run's own signal did not fire: only this call was stopped.
                    return { ...(result as object), outerAborted: ctx.signal.aborted };
                },
            })),
        ]);
        const { run } = await extended.run();

        const result = await run(
            { project: 'storefront', environment: 'staging' },
            context([], outer.signal),
        );

        expect(innerStopped).toBe(true);
        expect(result).toEqual({ deployed: 'stopped', outerAborted: false });
    });

    it('passes on the events of the inner run as they happen', async () => {
        const events: CommandEvent[] = [];
        const order: string[] = [];
        await runExtended(
            [
                cloudExtension(async () => ({
                    run: async (_input, _ctx, next) => {
                        const running = next();
                        const result = await running;
                        order.push(`resolved after ${events.length} event(s)`);
                        return result;
                    },
                })),
            ],
            { project: 'storefront' },
            context(events),
        );

        expect(events.map(event => event.type)).toEqual(['progress']);
        expect(order).toEqual(['resolved after 1 event(s)']);
    });

    it('runs two extensions with the first outermost, each with its own fields', async () => {
        const order: string[] = [];
        const second = defineCommandExtension({
            path: ['acme', 'deploy'],
            schemas: async () => ({ input: objectSchema({ region: { type: 'string' } }) }),
            run: async () => ({
                run: async (input, _ctx, next) => {
                    order.push(`second ${JSON.stringify(input)}`);
                    return next();
                },
            }),
        });
        await runExtended(
            [
                cloudExtension(async () => ({
                    run: async (input, _ctx, next) => {
                        order.push(`first ${JSON.stringify(input)}`);
                        return next();
                    },
                })),
                second,
            ],
            { project: 'storefront', region: 'eu' },
        );

        expect(order).toEqual([
            'first {"environment":"staging","project":"storefront"}',
            'second {"environment":"staging","region":"eu"}',
        ]);
    });

    it("gives the command's plan() its own fields only", async () => {
        let planned: unknown;
        const withPlan = defineCommand({
            ...deploy,
            plan: async () => ({
                plan: async (input: unknown) => {
                    planned = input;
                    return { preview: {}, requiredConsents: [] };
                },
            }),
        });
        const extended = applyCommandExtensions(withPlan, [
            cloudExtension(async () => ({ run: async (_input, _ctx, next) => next() })),
        ]);
        const { plan } = await extended.plan!();

        await plan({ project: 'storefront', environment: 'staging' }, context());

        expect(planned).toEqual({ environment: 'staging' });
    });

    it('refuses a consent or an error code two parts declare, and an extension of another path', () => {
        expect(() =>
            applyCommandExtensions(deploy, [
                defineCommandExtension({
                    ...cloudExtension(async () => ({ run: async () => ({}) })),
                    consents: { overwrite: 'x' },
                }),
            ]),
        ).toThrow('Two parts of "acme deploy" declare the consent "overwrite"');
        expect(() =>
            applyCommandExtensions(deploy, [
                defineCommandExtension({
                    ...cloudExtension(async () => ({ run: async () => ({}) })),
                    errors: [defineError({ code: 'acme.down', exit: 1, message: () => 'x' })],
                }),
            ]),
        ).toThrow('Two parts of "acme deploy" declare the error "acme.down"');
        expect(() =>
            applyCommandExtensions(deploy, [
                defineCommandExtension({
                    ...cloudExtension(async () => ({ run: async () => ({}) })),
                    path: ['dev'],
                }),
            ]),
        ).toThrow('An extension of "dev" was applied to "acme deploy"');
    });
});

describe('extensionDeclarations', () => {
    it('reads extensions from a module, or its default export, and none when it has none', () => {
        const extension = cloudExtension(async () => ({ run: async () => ({}) }));
        expect(extensionDeclarations({ extensions: [extension] })).toEqual([extension]);
        expect(extensionDeclarations({ default: { extensions: [extension] } })).toEqual([extension]);
        expect(extensionDeclarations({ commands: [] })).toEqual([]);
        expect(() => extensionDeclarations({ extensions: {} })).toThrow('not a list');
    });
});
