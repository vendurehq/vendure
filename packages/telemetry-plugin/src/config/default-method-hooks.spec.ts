import { JobQueue } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { MethodHookConfig } from '../types';

import { defaultMethodHooks } from './default-method-hooks';

// Job data can hold password reset and verification tokens, which must not
// be exported to the trace backend.
describe('default JobQueue.add method hook', () => {
    function runAddHook(data: unknown) {
        const jobQueueHooks = defaultMethodHooks.find(config => config.target === JobQueue) as
            | MethodHookConfig<JobQueue>
            | undefined;
        const attributes: Record<string, unknown> = {};
        const span = {
            setAttribute: (key: string, value: unknown) => {
                attributes[key] = value;
            },
        };
        const pre = jobQueueHooks?.hooks.add?.pre;
        if (typeof pre !== 'function') {
            throw new Error('The default method hooks have no JobQueue.add pre hook');
        }
        pre({
            instance: { name: 'send-email' },
            args: [data, { retries: 5 }],
            span,
        } as any);
        return attributes;
    }

    it('records only the top-level key names of the job data', () => {
        const attributes = runAddHook({
            ctx: { _session: { token: 'session-token' } },
            type: 'password-reset',
            recipient: 'victim@test.com',
            templateVars: { passwordResetToken: 'reset-token-value' },
        });

        expect(attributes['job.data']).toBe(JSON.stringify(['ctx', 'type', 'recipient', 'templateVars']));
        expect(String(attributes['job.data'])).not.toContain('reset-token-value');
        expect(String(attributes['job.data'])).not.toContain('victim@test.com');
        expect(attributes['job.queueName']).toBe('send-email');
        expect(attributes['job.retries']).toBe(5);
    });

    it('records an empty list for data which is not an object', () => {
        expect(runAddHook(undefined)['job.data']).toBe('[]');
        expect(runAddHook('secret-string')['job.data']).toBe('[]');
    });
});
