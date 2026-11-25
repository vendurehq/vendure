import { ConsentNeed, defineCommand, incomplete, isIncompleteResult } from '@vendure/common/lib/command';
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

function prompter(agrees: boolean): Prompter & { askConsent: ReturnType<typeof vi.fn> } {
    return {
        askInput: async () => undefined,
        askConsent: vi.fn(async () => agrees),
        confirm: async () => undefined,
        select: async () => undefined,
        text: async () => undefined,
    };
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
    });

    it('asks a person, and runs on when they agree', async () => {
        const person = prompter(true);

        const result = await testCommand(deploy, { target: 'production' }, { prompter: person });

        expect(person.askConsent).toHaveBeenCalledWith(expect.objectContaining({ digest }));
        expect(result.envelope).toMatchObject({ status: 'ok', output: { deployed: 'production' } });
    });

    it('cancels the run when a person declines, whatever run() returns', async () => {
        const result = await testCommand(deploy, { target: 'production' }, { prompter: prompter(false) });

        expect(result.envelope).toMatchObject({ status: 'error', error: { code: 'cli.cancelled' } });
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
                    return isIncompleteResult(answer) ? answer : {};
                },
            }),
        });

        const result = await testCommand(undeclared, {});

        expect(result.envelope).toMatchObject({
            status: 'error',
            error: { code: 'cli.internal', message: expect.stringContaining('"wipe"') },
        });
    });
});
