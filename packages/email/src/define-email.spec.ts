import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Job, RequestContext, VendureEvent } from '@vendure/core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { ejectTemplate } from './cli';
import { defineEmail, prepareEmail } from './define-email';
import { defineEmailTemplate } from './template/email-template';

class TestEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext, // eslint-disable-line @typescript-eslint/no-shadow
        public send: boolean,
    ) {
        super();
    }
}

const ctx = RequestContext.deserialize({ _channel: { code: 'default' }, _languageCode: LanguageCode.en } as any);
const testTemplate = defineEmailTemplate<{ when: string }>({ subject: 'Hi', body: () => null });

const email = defineEmail({
    type: 'test',
    event: TestEvent,
    filter: event => event.send,
    data: () => ({ when: new Date('2026-01-01T00:00:00Z') as unknown as string }),
    recipient: () => ({ to: 'a@test.com', cc: 'b@test.com' }),
    languageCode: () => LanguageCode.de,
    metadata: () => ({ orderId: 1 }),
    template: testTemplate,
});

const options = { injector: {} as any, globals: { shop: 'Test' }, defaultFrom: '"Shop" <x@test.com>' };

describe('prepareEmail()', () => {
    it('returns filtered when the filter rejects the event', async () => {
        expect(await prepareEmail(email, new TestEvent(ctx, false), options)).toEqual({ status: 'filtered' });
    });

    it('builds the job from the definition', async () => {
        const result = await prepareEmail(email, new TestEvent(ctx, true), options);
        if (result.status !== 'ready') {
            throw new Error(result.status);
        }
        const job = new Job({ queueName: 'send-email', data: result.job }).data;
        expect(job).toMatchObject({
            type: 'test',
            from: '"Shop" <x@test.com>',
            recipient: 'a@test.com',
            cc: 'b@test.com',
            languageCode: 'de',
            channelCode: 'default',
            metadata: { orderId: 1 },
            templateVars: { shop: 'Test', when: '2026-01-01T00:00:00.000Z' },
        });
    });

    it('reports the stage when a definition function throws', async () => {
        const failing = defineEmail({
            ...email,
            data: () => {
                throw new Error('boom');
            },
        });
        const result = await prepareEmail(failing, new TestEvent(ctx, true), options);
        expect(result).toMatchObject({ status: 'failed', stage: 'data' });
    });

    it('fails when there is no recipient', async () => {
        const noRecipient = defineEmail({ ...email, recipient: () => '' });
        const result = await prepareEmail(noRecipient, new TestEvent(ctx, true), options);
        expect(result).toMatchObject({ status: 'failed', stage: 'recipient' });
    });
});

describe('vendure email eject', () => {
    it('copies the template with package imports and writes a definition spreading the default', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-email-eject-'));
        const cwd = process.cwd();
        process.chdir(dir);
        try {
            const result = await ejectTemplate('order-shipped', 'src/email', false);
            expect(result.definitionExport).toBe('orderShippedEmail');
            expect(result.importPath).toBe('./email/order-shipped/definition');
            const template = fs.readFileSync(path.join(dir, 'src/email/order-shipped/template.tsx'), 'utf-8');
            expect(template).not.toContain("'../../");
            expect(template).toContain("from '@vendure/email';");
            expect(template).toContain('export const OrderShippedTemplate = defineEmailTemplate');
            const definition = fs.readFileSync(path.join(dir, 'src/email/order-shipped/definition.ts'), 'utf-8');
            expect(definition).toContain("import { defineEmail, orderShippedEmail as packageDefault } from '@vendure/email';");
            expect(definition).toContain('...packageDefault,');
            await expect(ejectTemplate('order-shipped', 'src/email', false)).rejects.toThrow('--force');
            await expect(ejectTemplate('nope', 'src/email', false)).rejects.toThrow('Available: ');
        } finally {
            process.chdir(cwd);
        }
    });
});
