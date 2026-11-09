import { ModuleRef } from '@nestjs/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Channel,
    ChannelService,
    Injector,
    LanguageCode,
    RequestContext,
    RequestContextService,
    VendureEvent,
} from '@vendure/core';
import express from 'express';
import fs from 'fs-extra';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EmailRenderService } from '../email-render.service';
import { EmailEventListener } from '../event-listener';
import { ReactEmailGenerator } from '../generator/react-email-generator';
import { EmailEventHandler } from '../handler/event-handler';
import { defineEmailTemplate } from '../template/email-template';
import { InitializedEmailPluginOptions, IntermediateEmailDetails } from '../types';

import { DevEmailApi, parseSince } from './dev-email-api';
import { DevOutbox } from './dev-outbox';

class SignupEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public email: string,
        public signedUpAt: Date,
    ) {
        super();
    }
}

const WelcomeEmail = defineEmailTemplate<{ email: string; signedUpAt: string }>(({ email, signedUpAt }) =>
    createElement('p', null, `Welcome ${email}, signed up ${typeof signedUpAt}`),
);

function welcomeHandler(type = 'welcome') {
    return new EmailEventListener(type)
        .on(SignupEvent)
        .setRecipient(event => event.email)
        .setFrom('noreply@test.com')
        .setSubject('Welcome {{ email }}')
        .setTemplateVars(event => ({ email: event.email, signedUpAt: event.signedUpAt }))
        .setTemplate(WelcomeEmail)
        .setSampleEvent(({ ctx, args }) =>
            args.email === 'nobody@test.com'
                ? undefined
                : new SignupEvent(ctx, args.email ?? 'sample@test.com', new Date('2026-01-02T03:04:05Z')),
        );
}

describe('DevEmailApi', () => {
    let outputPath: string;
    let outbox: DevOutbox;
    let enqueued: IntermediateEmailDetails[];

    beforeEach(async () => {
        outputPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-dev-outbox-'));
        outbox = new DevOutbox(path.join(outputPath, '.outbox'));
        enqueued = [];
    });

    afterEach(async () => {
        await fs.remove(outputPath);
    });

    function createApi(
        handlers: Array<EmailEventHandler<string, any>>,
        enqueue?: (details: IntermediateEmailDetails) => Promise<void>,
    ) {
        const options = {
            devMode: true,
            route: 'mailbox',
            outputPath,
            handlers,
            templateLoaders: [],
            emailGenerators: [new ReactEmailGenerator()],
        } as unknown as InitializedEmailPluginOptions & { devMode: true; outputPath: string; route: string };
        const channel = new Channel({ code: DEFAULT_CHANNEL_CODE, defaultLanguageCode: LanguageCode.en });
        const services = new Map<any, any>([
            [ChannelService, { getDefaultChannel: async () => channel }],
            [
                RequestContextService,
                {
                    create: async ({ languageCode }: { languageCode: LanguageCode }) =>
                        new RequestContext({
                            apiType: 'admin',
                            channel,
                            languageCode,
                            isAuthorized: true,
                            authorizedAsOwnerOnly: false,
                        }),
                },
            ],
        ]);
        const injector = { get: (token: any) => services.get(token) } as unknown as Injector;
        return new DevEmailApi({
            options,
            injector,
            renderService: new EmailRenderService(options, {} as ModuleRef),
            outbox,
            resolveGlobalTemplateVars: async () => ({ shopName: 'Test Shop' }),
            enqueue:
                enqueue ??
                (async details => {
                    enqueued.push(details);
                }),
        });
    }

    async function expectStage(promise: Promise<unknown>, stage: string, message?: string) {
        await expect(promise).rejects.toMatchObject({ stage, ...(message ? {} : {}) });
        if (message) {
            await expect(promise).rejects.toThrow(message);
        }
    }

    it('lists the configured emails and their sample data source', () => {
        const mockOnly = new EmailEventListener('mock-only')
            .on(SignupEvent)
            .setMockEvent({ email: 'mock@test.com' } as any);
        const result = createApi([welcomeHandler(), mockOnly]).listEmails();
        expect(result.emails).toEqual([
            { type: 'welcome', event: 'SignupEvent', template: 'react', sampleData: 'database' },
            { type: 'mock-only', event: 'SignupEvent', template: 'loader-only', sampleData: 'mock' },
        ]);
    });

    describe('render', () => {
        it('renders the email from the sample event, with job-queue serialized template vars', async () => {
            const result = await createApi([welcomeHandler()]).render({ type: 'welcome', args: {} });
            expect(result.sampleSource).toBe('database');
            expect(result.email.recipient).toBe('sample@test.com');
            expect(result.email.subject).toBe('Welcome sample@test.com');
            // The Date became an ISO string, as it does on the job queue
            expect(result.email.html).toContain('Welcome sample@test.com, signed up string');
            expect(result.templateVars.signedUpAt).toBe('2026-01-02T03:04:05.000Z');
            expect(result.templateVars.shopName).toBe('Test Shop');
            expect(result.email.templateOrigin).toBe('handler');
        });

        it('passes args to the sample event function', async () => {
            const result = await createApi([welcomeHandler()]).render({
                type: 'welcome',
                args: { email: 'given@test.com' },
            });
            expect(result.email.recipient).toBe('given@test.com');
        });

        it('uses the requested language', async () => {
            const result = await createApi([welcomeHandler()]).render({
                type: 'welcome',
                languageCode: 'de',
            });
            expect(result.languageCode).toBe('de');
        });

        it('reports an unknown type at the lookup stage, listing the available types', async () => {
            await expectStage(
                createApi([welcomeHandler()]).render({ type: 'nope' }),
                'lookup',
                'Available types: welcome',
            );
        });

        it('reports missing sample data at the sample stage', async () => {
            await expectStage(
                createApi([welcomeHandler()]).render({ type: 'welcome', args: { email: 'nobody@test.com' } }),
                'sample',
                'No sample data found',
            );
        });

        it('falls back to the mock event when there is no sample event', async () => {
            const handler = new EmailEventListener('mocked')
                .on(SignupEvent)
                .setRecipient(event => event.email)
                .setFrom('noreply@test.com')
                .setSubject('Hi')
                .setTemplateVars(event => ({ email: event.email, signedUpAt: event.signedUpAt }))
                .setTemplate(WelcomeEmail)
                .setMockEvent({ email: 'mock@test.com', signedUpAt: new Date() } as any);
            const result = await createApi([handler]).render({ type: 'mocked' });
            expect(result.sampleSource).toBe('mock');
            expect(result.email.recipient).toBe('mock@test.com');
        });

        it('reports which filter rejected the sample event', async () => {
            const handler = welcomeHandler()
                .filter(() => true)
                .filter(() => false);
            await expectStage(createApi([handler]).render({ type: 'welcome' }), 'filter', 'Filter #2');
        });

        it('reports a loadData() error at the loadData stage', async () => {
            const handler = welcomeHandler().loadData(() => {
                throw new Error('database is on fire');
            });
            await expectStage(
                createApi([handler]).render({ type: 'welcome' }),
                'loadData',
                'database is on fire',
            );
        });

        it('reports a template error at the render stage', async () => {
            const handler = welcomeHandler().setTemplate(
                defineEmailTemplate(() => {
                    throw new Error('template exploded');
                }),
            );
            await expectStage(
                createApi([handler]).render({ type: 'welcome' }),
                'render',
                'template exploded',
            );
        });
    });

    describe('send', () => {
        it('queues the prepared email with a correlation id and an optional recipient override', async () => {
            const result = await createApi([welcomeHandler()]).send({ type: 'welcome', to: 'me@test.com' });
            expect(result).toMatchObject({ ok: true, queued: true });
            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].recipient).toBe('me@test.com');
            expect(enqueued[0].devCorrelationId).toBe(result.correlationId);
        });

        it('waits for the outbox entry of the queued email', async () => {
            const api = createApi([welcomeHandler()], async details => {
                setTimeout(() => {
                    void outbox.record({
                        status: 'sent',
                        type: details.type,
                        recipient: details.recipient,
                        attachments: [],
                        correlationId: details.devCorrelationId,
                        html: '<p>hi</p>',
                    });
                }, 50);
            });
            const result = await api.send({ type: 'welcome', waitMs: 2000 });
            expect(result.entry).toMatchObject({ status: 'sent', recipient: 'sample@test.com' });
            expect(result.entry).not.toHaveProperty('html');
        });

        it('reports a worker failure recorded in the outbox', async () => {
            const api = createApi([welcomeHandler()], async details => {
                await outbox.record({
                    status: 'failed',
                    type: details.type,
                    attachments: [],
                    correlationId: details.devCorrelationId,
                    error: { message: 'SMTP said no' },
                });
            });
            await expectStage(api.send({ type: 'welcome', waitMs: 1000 }), 'render', 'SMTP said no');
        });

        it('times out with a hint about the worker when nothing reaches the outbox', async () => {
            const promise = createApi([welcomeHandler()]).send({ type: 'welcome', waitMs: 300 });
            await expect(promise).rejects.toMatchObject({ stage: 'queue', statusCode: 504 });
            await expect(promise).rejects.toThrow('Is a Vendure worker running');
        });
    });

    describe('check', () => {
        it('renders every email in every requested language', async () => {
            const broken = welcomeHandler('broken').setTemplate(
                defineEmailTemplate(() => {
                    throw new Error('boom');
                }),
            );
            const filtered = welcomeHandler('filtered').filter(() => false);
            const result = await createApi([welcomeHandler(), broken, filtered]).check({
                languageCodes: ['en', 'de'],
            });
            expect(result.ok).toBe(false);
            expect(result.results.map(r => [r.type, r.languageCode, r.ok, r.stage])).toEqual([
                ['welcome', 'en', true, undefined],
                ['welcome', 'de', true, undefined],
                ['broken', 'en', false, 'render'],
                ['broken', 'de', false, 'render'],
                ['filtered', 'en', true, 'filter'],
                ['filtered', 'de', true, 'filter'],
            ]);
        });
    });

    describe('outbox', () => {
        it('filters by type, recipient and time, newest first', async () => {
            await outbox.record({ status: 'sent', type: 'a', recipient: 'x@test.com', attachments: [] });
            await new Promise(r => setTimeout(r, 5));
            await outbox.record({ status: 'failed', type: 'b', recipient: 'y@test.com', attachments: [] });
            const api = createApi([]);

            const all = await api.listOutbox({});
            expect(all.entries.map(e => e.type)).toEqual(['b', 'a']);
            expect((await api.listOutbox({ type: 'a' })).entries).toHaveLength(1);
            expect((await api.listOutbox({ to: 'Y@TEST.COM' })).entries.map(e => e.type)).toEqual(['b']);
            expect((await api.listOutbox({ status: 'failed' })).entries.map(e => e.type)).toEqual(['b']);
            expect(
                (await api.listOutbox({ since: new Date(Date.now() + 60_000).toISOString() })).entries,
            ).toEqual([]);
        });

        it('waits for a matching entry', async () => {
            const api = createApi([]);
            setTimeout(() => {
                void outbox.record({ status: 'sent', type: 'late', attachments: [] });
            }, 100);
            const result = await api.listOutbox({ type: 'late', waitMs: '2000' });
            expect(result.entries).toHaveLength(1);
        });
    });

    it('serves the API over HTTP with error status codes', async () => {
        const app = express().use('/api', createApi([welcomeHandler()]).router());
        const server = app.listen(0);
        try {
            const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
            const list = await (await fetch(`${base}/emails`)).json();
            expect(list.emails[0].type).toBe('welcome');

            const missing = await fetch(`${base}/render`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'missing' }),
            });
            expect(missing.status).toBe(404);
            expect(await missing.json()).toMatchObject({ ok: false, stage: 'lookup' });

            const rendered = await fetch(`${base}/render`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'welcome', args: { email: 'http@test.com' } }),
            });
            expect(rendered.status).toBe(200);
            expect((await rendered.json()).email.recipient).toBe('http@test.com');
        } finally {
            server.close();
        }
    });
});

describe('parseSince()', () => {
    it('parses relative durations', () => {
        const fiveMinutesAgo = Date.now() - 5 * 60_000;
        expect(Math.abs(parseSince('5m').getTime() - fiveMinutesAgo)).toBeLessThan(1000);
        expect(Math.abs(parseSince('2h').getTime() - (Date.now() - 2 * 3_600_000))).toBeLessThan(1000);
    });

    it('parses ISO dates and rejects garbage', () => {
        expect(parseSince('2026-01-01T00:00:00Z').toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(() => parseSince('yesterday')).toThrow('Invalid "since" value');
    });
});
