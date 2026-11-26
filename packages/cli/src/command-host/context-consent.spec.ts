import { ConsentNeed, defineCommand, incomplete } from '@vendure/common/lib/command';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { testCommand } from '../index.js';

import { consentDigest } from './digest.js';
import { Prompter } from './host.js';

/** A command that finds out at run time that its target is production, and asks for a consent. */
const deploy = defineCommand({
    path: ['acme', 'deploy'],
    description: 'Deploy',
    behavior: 'mutating',
    consents: { deployToProduction: 'Deploy to the production environment.' },
    schemas: async () => ({ input: z.object({ target: z.string() }) }),
    run: async () => ({
        run: async (input: { target: string }, ctx) => {
            const answer = await ctx.consent('deployToProduction', { environment: input.target });
            if (answer !== true) {
                return incomplete([answer]);
            }
            return { deployed: input.target };
        },
    }),
});

const preview = { environment: 'production' };
const digest = consentDigest('deployToProduction', preview);

/** A person who agrees to every consent, or declines it. `askConsent` records what they were asked. */
function person(agrees: boolean, answer?: string) {
    const askConsent = vi.fn(async () => agrees);
    const answers: Prompter = {
        askInput: async () => answer,
        askConsent,
        confirm: async () => undefined,
        select: async () => undefined,
        text: async () => undefined,
    };
    return { prompter: answers, askConsent };
}

function prompter(agrees: boolean): Prompter {
    return person(agrees).prompter;
}

describe('ctx.consent', () => {
    it('returns the consent need, with the host digest, when nobody is there to ask', async () => {
        const result = await testCommand(deploy, { target: 'production' });

        expect(result.envelope).toMatchObject({
            status: 'incomplete',
            needs: [
                {
                    kind: 'consent',
                    consent: 'deployToProduction',
                    description: 'Deploy to the production environment.',
                    digest,
                    preview,
                },
            ],
        });
    });

    it('is granted when the input holds the digest of the same preview', async () => {
        const result = await testCommand(deploy, { target: 'production', deployToProduction: digest });

        expect(result.envelope).toMatchObject({ status: 'ok', output: { deployed: 'production' } });
    });

    it('asks again when the digest answers another preview', async () => {
        const result = await testCommand(deploy, { target: 'staging', deployToProduction: digest });

        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.needs?.[0]).toMatchObject({
            digest: consentDigest('deployToProduction', { environment: 'staging' }),
        });
    });

    it('asks a person, and runs on when they agree', async () => {
        const { prompter: agreeing, askConsent } = person(true);

        const result = await testCommand(deploy, { target: 'production' }, { prompter: agreeing });

        expect(askConsent).toHaveBeenCalledWith(expect.objectContaining({ digest }));
        expect(result.envelope).toMatchObject({ status: 'ok', output: { deployed: 'production' } });
    });

    it('cancels the run when a person declines, whatever run() returns', async () => {
        const result = await testCommand(deploy, { target: 'production' }, { prompter: prompter(false) });

        expect(result.envelope).toMatchObject({ status: 'error', error: { code: 'cli.cancelled' } });
        expect(result.envelope.output).toBeUndefined();
    });

    it('keeps what run() reported when a person declines', async () => {
        const partial = defineCommand({
            path: ['acme', 'partial'],
            description: 'Partial',
            behavior: 'mutating',
            consents: { deployToProduction: 'Deploy to the production environment.' },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx) => {
                    const answer = await ctx.consent('deployToProduction', preview);
                    return answer === true
                        ? { built: true, deployed: true }
                        : incomplete([answer], { built: true });
                },
            }),
        });

        const result = await testCommand(partial, {}, { prompter: prompter(false) });

        expect(result.envelope).toMatchObject({
            status: 'error',
            error: { code: 'cli.cancelled' },
            output: { built: true },
        });
    });

    it('does not ask again for a consent a person agreed to, when the host asks for more input', async () => {
        let runs = 0;
        const twoStep = defineCommand({
            path: ['acme', 'two-step'],
            description: 'Two step',
            behavior: 'mutating',
            consents: { deployToProduction: 'Deploy to the production environment.' },
            schemas: async () => ({ input: z.object({ region: z.string().optional() }) }),
            run: async () => ({
                run: async (input: { region?: string }, ctx) => {
                    runs++;
                    const answer = await ctx.consent('deployToProduction', preview);
                    if (answer !== true) {
                        return incomplete([answer]);
                    }
                    if (!input.region) {
                        return incomplete([{ kind: 'input', field: 'region', description: 'The region' }]);
                    }
                    return { region: input.region };
                },
            }),
        });
        const { prompter: agreeing, askConsent } = person(true, 'eu');

        const result = await testCommand(twoStep, {}, { prompter: agreeing });

        expect(result.envelope).toMatchObject({ status: 'ok', output: { region: 'eu' } });
        expect(runs).toBe(2);
        expect(askConsent).toHaveBeenCalledTimes(1);
    });

    it('is for run() only: plan() and input choices name their consents in requiredConsents', async () => {
        const early = defineCommand({
            path: ['acme', 'early'],
            description: 'Early',
            behavior: 'mutating',
            consents: { deployToProduction: 'Deploy to the production environment.' },
            schemas: async () => ({ input: z.object({}) }),
            plan: async () => ({
                plan: async (_input: object, ctx) => {
                    await ctx.consent('deployToProduction', preview);
                    return { preview, requiredConsents: [] };
                },
            }),
            run: async () => ({ run: async () => ({}) }),
        });

        const result = await testCommand(early, {});

        expect(result.envelope).toMatchObject({
            status: 'error',
            error: {
                code: 'cli.internal',
                message: 'ctx.consent is for run(); plan() returns requiredConsents',
            },
        });

        const choosing = defineCommand({
            path: ['acme', 'choosing'],
            description: 'Choosing',
            behavior: 'mutating',
            consents: { deployToProduction: 'Deploy to the production environment.' },
            schemas: async () => ({ input: z.object({ target: z.string() }) }),
            cli: {
                fields: {
                    target: {
                        choices: async ctx => {
                            await ctx.consent('deployToProduction', preview);
                            return ['staging'];
                        },
                    },
                },
            },
            run: async () => ({ run: async () => ({}) }),
        });

        const chosen = await testCommand(choosing, {});

        expect(chosen.envelope).toMatchObject({
            status: 'error',
            error: {
                code: 'cli.internal',
                message: 'ctx.consent is for run(); plan() returns requiredConsents',
            },
        });
    });

    it('asks a person once for two calls at the same time with the same preview', async () => {
        const askConsent = vi.fn(async () => true);
        const twice = defineCommand({
            path: ['acme', 'twice'],
            description: 'Twice',
            behavior: 'mutating',
            consents: { deployToProduction: 'Deploy to the production environment.' },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx) => {
                    const answers = await Promise.all([
                        ctx.consent('deployToProduction', preview),
                        ctx.consent('deployToProduction', preview),
                    ]);
                    return { answers };
                },
            }),
        });

        const result = await testCommand(twice, {}, { prompter: { ...prompter(true), askConsent } });

        expect(result.envelope.output).toEqual({ answers: [true, true] });
        expect(askConsent).toHaveBeenCalledTimes(1);
    });

    it('asks once and cancels when a person declines the first of two calls at the same time', async () => {
        const askConsent = vi.fn(async () => false);
        const both = defineCommand({
            path: ['acme', 'both'],
            description: 'Both',
            behavior: 'mutating',
            consents: {
                deployToProduction: 'Deploy to the production environment.',
                dropCache: 'Drop the cache.',
            },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx) => {
                    const answers = await Promise.all([
                        ctx.consent('deployToProduction', preview),
                        ctx.consent('dropCache', { cache: 'all' }),
                    ]);
                    return { answered: answers.filter(answer => answer === true).length };
                },
            }),
        });

        const result = await testCommand(both, {}, { prompter: { ...prompter(true), askConsent } });

        expect(askConsent).toHaveBeenCalledTimes(1);
        expect(result.envelope.error?.code).toBe('cli.cancelled');
    });

    it('cancels a run that throws after a person declined', async () => {
        const throwing = defineCommand({
            path: ['acme', 'throwing'],
            description: 'Throwing',
            behavior: 'mutating',
            consents: { deployToProduction: 'Deploy to the production environment.' },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx) => {
                    if ((await ctx.consent('deployToProduction', preview)) !== true) {
                        throw new Error('not deploying');
                    }
                    return {};
                },
            }),
        });

        const result = await testCommand(throwing, {}, { prompter: prompter(false) });

        expect(result.envelope.error?.code).toBe('cli.cancelled');
    });

    it('refuses one consent asked for with two previews in one run', async () => {
        const twoTargets = defineCommand({
            path: ['acme', 'two-targets'],
            description: 'Two targets',
            behavior: 'mutating',
            consents: { deployToProduction: 'Deploy to the production environment.' },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx) => {
                    for (const target of ['eu', 'us']) {
                        const answer = await ctx.consent('deployToProduction', { target });
                        if (answer !== true) {
                            return incomplete([answer]);
                        }
                    }
                    return {};
                },
            }),
        });

        const first = await testCommand(twoTargets, {});
        const need = first.envelope.needs?.[0];
        expect(need).toMatchObject({ kind: 'consent', preview: { target: 'eu' } });

        const second = await testCommand(twoTargets, {
            deployToProduction: need?.kind === 'consent' ? need.digest : undefined,
        });
        expect(second.envelope.error).toMatchObject({
            code: 'cli.internal',
            message: expect.stringContaining('two different previews in one run'),
        });
    });

    it('keeps a secret out of what a declined run reported, when no person sees the output', async () => {
        const minting = defineCommand({
            path: ['acme', 'minting'],
            description: 'Minting',
            behavior: 'mutating',
            consents: { deployToProduction: 'Deploy to the production environment.' },
            secretOutputs: ['token'],
            schemas: async () => ({
                input: z.object({}),
                output: z.object({ token: z.string().optional() }),
            }),
            run: async () => ({
                run: async (_input: object, ctx) => {
                    const answer = await ctx.consent('deployToProduction', preview);
                    return answer === true ? {} : incomplete([answer], { token: 's3cret' });
                },
            }),
        });
        const writeSecret = vi.fn(() => '/secrets/acme-minting-token');

        const result = await testCommand(minting, {}, { mcp: true, prompter: prompter(false), writeSecret });

        expect(result.envelope.status).toBe('error');
        expect(JSON.stringify(result.envelope)).not.toContain('s3cret');
        expect(writeSecret).toHaveBeenCalledWith(['acme', 'minting'], 'token', 's3cret');
    });

    it('refuses a consent the command does not declare', async () => {
        const undeclared = defineCommand({
            path: ['acme', 'undeclared'],
            description: 'Undeclared',
            behavior: 'mutating',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx) => {
                    const answer: true | ConsentNeed = await ctx.consent('wipe', {});
                    return answer === true ? {} : incomplete([answer]);
                },
            }),
        });

        const result = await testCommand(undeclared, {});

        expect(result.envelope).toMatchObject({
            status: 'error',
            error: { code: 'cli.internal', message: expect.stringContaining('"wipe"') },
        });
    });

    it('does not count a name every object inherits as declared, in run() or in plan()', async () => {
        const inherited = (fromPlan: boolean) =>
            defineCommand({
                path: ['acme', 'inherited'],
                description: 'Inherited',
                behavior: 'mutating',
                consents: { deployToProduction: 'Deploy to the production environment.' },
                schemas: async () => ({ input: z.object({}) }),
                ...(fromPlan
                    ? {
                          plan: async () => ({
                              plan: async () => ({ preview, requiredConsents: ['toString'] }),
                          }),
                      }
                    : {}),
                run: async () => ({
                    run: async (_input: object, ctx) => {
                        const answer = await ctx.consent('toString', preview);
                        return answer === true ? {} : incomplete([answer]);
                    },
                }),
            });

        for (const fromPlan of [false, true]) {
            const result = await testCommand(inherited(fromPlan), {});
            expect(result.envelope).toMatchObject({
                status: 'error',
                error: { code: 'cli.internal', message: expect.stringContaining('"toString"') },
            });
        }
    });
});
