/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    EntityHydrator,
    EventBus,
    Injector,
    JobQueueService,
    LanguageCode,
    Logger,
    Order,
    OrderStateTransitionEvent,
    PluginCommonModule,
    RequestContext,
    VendureEvent,
} from '@vendure/core';
import { ensureConfigLoaded } from '@vendure/core/dist/config/config-helpers';
import { TestingLogger } from '@vendure/testing';
import { createReadStream, readFileSync } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { EmailProcessor } from './email-processor';
import { EmailEventListener } from './event-listener';
import { orderConfirmationHandler } from './handler/default-email-handlers';
import { EmailEventHandler } from './handler/event-handler';
import { EmailPlugin } from './plugin';
import { EmailSender } from './sender/email-sender';
import { FileBasedTemplateLoader } from './template-loader/file-based-template-loader';
import { TemplateLoader } from './template-loader/template-loader';
import {
    EmailDetails,
    Partial as EmailPartial,
    EmailPluginOptions,
    EmailTransportOptions,
    LoadTemplateInput,
} from './types';

describe('EmailPlugin', () => {
    let eventBus: EventBus;
    let onSend: Mock;
    let module: TestingModule;

    const testingLogger = new TestingLogger((...args) => vi.fn(...args));

    async function initPluginWithHandlers(
        handlers: Array<EmailEventHandler<string, any>>,
        options?: Partial<EmailPluginOptions>,
    ) {
        await ensureConfigLoaded();
        onSend = vi.fn();
        module = await Test.createTestingModule({
            imports: [
                TypeOrmModule.forRoot({
                    type: 'sqljs',
                    retryAttempts: 0,
                }),
                PluginCommonModule,
                EmailPlugin.init({
                    templateLoader: new FileBasedTemplateLoader(path.join(__dirname, '../test-templates')),
                    transport: {
                        type: 'testing',
                        onSend,
                    },
                    handlers,
                    ...options,
                }),
            ],
            providers: [MockService],
        })
            .overrideProvider(EntityHydrator)
            .useValue({
                hydrate() {
                    // noop
                },
            })
            .compile();

        Logger.useLogger(testingLogger);
        module.useLogger(new Logger());

        const plugin = module.get(EmailPlugin);
        eventBus = module.get(EventBus);
        await plugin.onApplicationBootstrap();
        return module;
    }

    afterEach(async () => {
        if (module) {
            await module.close();
        }
    });

    it('setting from, recipient, subject', async () => {
        const ctx = RequestContext.deserialize({
            _channel: { code: DEFAULT_CHANNEL_CODE },
            _languageCode: LanguageCode.en,
        } as any);
        const handler = new EmailEventListener('test')
            .on(MockEvent)
            .setFrom('"test from" <noreply@test.com>')
            .setRecipient(() => 'test@test.com')
            .setSubject('Hello')
            .setTemplateVars(event => ({ subjectVar: 'foo' }));

        await initPluginWithHandlers([handler]);

        await eventBus.publish(new MockEvent(ctx, true));
        await pause();
        expect(onSend.mock.calls[0][0].subject).toBe('Hello');
        expect(onSend.mock.calls[0][0].recipient).toBe('test@test.com');
        expect(onSend.mock.calls[0][0].from).toBe('"test from" <noreply@test.com>');
    });

    describe('event filtering', () => {
        const ctx = RequestContext.deserialize({
            _channel: { code: DEFAULT_CHANNEL_CODE },
            _languageCode: LanguageCode.en,
        } as any);

        it('single filter', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .filter(event => event.shouldSend === true)
                .setRecipient(() => 'test@test.com')
                .setFrom('"test from" <noreply@test.com>')
                .setSubject('test subject');

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, false));
            await pause();
            expect(onSend).not.toHaveBeenCalled();

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend).toHaveBeenCalledTimes(1);
        });

        it('multiple filters', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .filter(event => event.shouldSend === true)
                .filter(event => !!event.ctx.activeUserId)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('test subject');

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend).not.toHaveBeenCalled();

            const ctxWithUser = RequestContext.deserialize({ ...ctx, _session: { user: { id: 42 } } } as any);

            await eventBus.publish(new MockEvent(ctxWithUser, true));
            await pause();
            expect(onSend).toHaveBeenCalledTimes(1);
        });

        it('with .loadData() after .filter()', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .filter(event => event.shouldSend === true)
                .loadData(context => Promise.resolve('loaded data'))
                .setRecipient(() => 'test@test.com')
                .setFrom('"test from" <noreply@test.com>')
                .setSubject('test subject');

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, false));
            await pause();
            expect(onSend).not.toHaveBeenCalled();

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend).toHaveBeenCalledTimes(1);
        });
    });

    describe('templateVars', () => {
        const ctx = RequestContext.deserialize({
            _channel: { code: DEFAULT_CHANNEL_CODE },
            _languageCode: LanguageCode.en,
        } as any);

        it('interpolates subject', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setTemplateVars(event => ({ subjectVar: 'foo' }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].subject).toBe('Hello foo');
        });

        it('interpolates body', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello')
                .setTemplateVars(event => ({ testVar: 'this is the test var' }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].body).toContain('this is the test var');
        });

        /**
         * Intended to test the ability for Handlebars to interpolate
         * getters on the Order entity prototype.
         * See https://github.com/vendurehq/vendure/issues/259
         */
        it('interpolates body with property from entity', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello')
                .setTemplateVars(event => ({ order: new Order({ subTotal: 123 }) }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].body).toContain('Total: 123');
        });

        it('interpolates globalTemplateVars', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ globalVar }}');

            await initPluginWithHandlers([handler], {
                globalTemplateVars: { globalVar: 'baz' },
            });

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].subject).toBe('Hello baz');
        });

        it('loads globalTemplateVars async', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Job {{ name }}, {{ primaryColor }}');

            await initPluginWithHandlers([handler], {
                globalTemplateVars: async (_ctxLocal: RequestContext, injector: Injector) => {
                    const jobQueueService = injector.get(JobQueueService);
                    const jobQueue = await jobQueueService.createQueue({
                        name: 'hello-service',
                        // eslint-disable-next-line
                        process: async job => {
                            return 'hello';
                        },
                    });
                    const name = jobQueue.name;

                    return {
                        name,
                        primaryColor: 'blue',
                    };
                },
            });

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].subject).toBe(`Job hello-service, blue`);
        });

        it('interpolates from', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from {{ globalVar }}" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello');

            await initPluginWithHandlers([handler], {
                globalTemplateVars: { globalVar: 'baz' },
            });

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].from).toBe('"test from baz" <noreply@test.com>');
        });

        // Test fix for https://github.com/vendurehq/vendure/issues/363
        it('does not escape HTML chars when interpolating "from"', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('{{ globalFrom }}')
                .setRecipient(() => 'Test <test@test.com>')
                .setSubject('Hello');

            await initPluginWithHandlers([handler], {
                globalTemplateVars: { globalFrom: 'Test <test@test.com>' },
            });

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].from).toBe('Test <test@test.com>');
        });

        it('globalTemplateVars available in setTemplateVars method', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ testVar }}')
                .setTemplateVars((event, globals) => ({ testVar: (globals.globalVar as string) + ' quux' }));

            await initPluginWithHandlers([handler], {
                globalTemplateVars: { globalVar: 'baz' },
            });

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].subject).toBe('Hello baz quux');
        });

        it('setTemplateVars overrides globals', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ name }}')
                .setTemplateVars((event, globals) => ({ name: 'quux' }));

            await initPluginWithHandlers([handler], { globalTemplateVars: { name: 'baz' } });

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].subject).toBe('Hello quux');
        });
    });

    describe('handlebars helpers', () => {
        const ctx = RequestContext.deserialize({
            _channel: { code: DEFAULT_CHANNEL_CODE },
            _languageCode: LanguageCode.en,
        } as any);

        it('formateDate', async () => {
            const handler = new EmailEventListener('test-helpers')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello')
                .setTemplateVars(event => ({ myDate: new Date('2020-01-01T10:00:00.000Z'), myPrice: 0 }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].body).toContain('Date: Wed Jan 01 2020 10:00:00');
        });

        it('formatMoney', async () => {
            const handler = new EmailEventListener('test-helpers')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello')
                .setTemplateVars(event => ({ myDate: new Date(), myPrice: 123 }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].body).toContain('Price: 1.23');
            expect(onSend.mock.calls[0][0].body).toContain('Price: €1.23');
            expect(onSend.mock.calls[0][0].body).toContain('Price: £1.23');
        });
    });

    describe('multiple configs', () => {
        const ctx = RequestContext.deserialize({
            _channel: { code: DEFAULT_CHANNEL_CODE },
            _languageCode: LanguageCode.en,
        } as any);

        it('additional LanguageCode', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setSubject('Hello, {{ name }}!')
                .setRecipient(() => 'test@test.com')
                .setTemplateVars(() => ({ name: 'Test' }))
                .addTemplate({
                    channelCode: 'default',
                    languageCode: LanguageCode.de,
                    templateFile: 'body.de.hbs',
                    subject: 'Servus, {{ name }}!',
                });

            await initPluginWithHandlers([handler]);

            const ctxTa = RequestContext.deserialize({ ...ctx, _languageCode: LanguageCode.ta } as any);
            await eventBus.publish(new MockEvent(ctxTa, true));
            await pause();
            expect(onSend.mock.calls[0][0].subject).toBe('Hello, Test!');
            expect(onSend.mock.calls[0][0].body).toContain('Default body.');

            const ctxDe = RequestContext.deserialize({ ...ctx, _languageCode: LanguageCode.de } as any);
            await eventBus.publish(new MockEvent(ctxDe, true));
            await pause();
            expect(onSend.mock.calls[1][0].subject).toBe('Servus, Test!');
            expect(onSend.mock.calls[1][0].body).toContain('German body.');
        });

        it('set LanguageCode', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setSubject('Hello, {{ name }}!')
                .setRecipient(() => 'test@test.com')
                .setLanguageCode(() => LanguageCode.de)
                .setTemplateVars(() => ({ name: 'Test' }))
                .addTemplate({
                    channelCode: 'default',
                    languageCode: LanguageCode.de,
                    templateFile: 'body.de.hbs',
                    subject: 'Servus, {{ name }}!',
                });

            const ctxEn = RequestContext.deserialize({ ...ctx, _languageCode: LanguageCode.en } as any);
            await eventBus.publish(new MockEvent(ctxEn, true));
            await pause();
            expect(onSend.mock.calls[1][0].subject).toBe('Servus, Test!');
            expect(onSend.mock.calls[1][0].body).toContain('German body.');
        });
    });

    describe('loadData', () => {
        it('loads async data', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .loadData(async ({ injector }) => {
                    const service = injector.get(MockService);
                    return service.someAsyncMethod();
                })
                .setFrom('"test from" <noreply@test.com>')
                .setSubject('Hello, {{ testData }}!')
                .setRecipient(() => 'test@test.com')
                .setTemplateVars(event => ({ testData: event.data }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(
                new MockEvent(
                    RequestContext.deserialize({
                        _channel: { code: DEFAULT_CHANNEL_CODE },
                        _languageCode: LanguageCode.en,
                    } as any),
                    true,
                ),
            );
            await pause();

            expect(onSend.mock.calls[0][0].subject).toBe('Hello, loaded data!');
        });

        it('works when loadData is called after other setup', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setSubject('Hello, {{ testData }}!')
                .setRecipient(() => 'test@test.com')
                .loadData(async ({ injector }) => {
                    const service = injector.get(MockService);
                    return service.someAsyncMethod();
                })
                .setTemplateVars(event => ({ testData: event.data }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(
                new MockEvent(
                    RequestContext.deserialize({
                        _channel: { code: DEFAULT_CHANNEL_CODE },
                        _languageCode: LanguageCode.en,
                    } as any),
                    true,
                ),
            );
            await pause();

            expect(onSend.mock.calls[0][0].subject).toBe('Hello, loaded data!');
            expect(onSend.mock.calls[0][0].from).toBe('"test from" <noreply@test.com>');
            expect(onSend.mock.calls[0][0].recipient).toBe('test@test.com');
        });

        it('only executes for filtered events', async () => {
            let callCount = 0;
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .filter(event => event.shouldSend === true)
                .loadData(async ({ injector }) => {
                    callCount++;
                });

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(RequestContext.empty(), false));
            await eventBus.publish(new MockEvent(RequestContext.empty(), true));
            await pause();

            expect(callCount).toBe(1);
        });
    });

    describe('attachments', () => {
        const ctx = RequestContext.deserialize({
            _channel: { code: DEFAULT_CHANNEL_CODE },
            _languageCode: LanguageCode.en,
        } as any);
        const TEST_IMAGE_PATH = path.join(__dirname, '../test-fixtures/test.jpg');

        it('attachments are empty by default', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}');

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].attachments).toEqual([]);
        });

        it('sync attachment', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setAttachments(() => [
                    {
                        path: TEST_IMAGE_PATH,
                    },
                ]);

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            expect(onSend.mock.calls[0][0].attachments).toEqual([{ path: TEST_IMAGE_PATH }]);
        });

        it('async attachment', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setAttachments(async () => [
                    {
                        path: TEST_IMAGE_PATH,
                    },
                ]);

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            expect(onSend.mock.calls[0][0].attachments).toEqual([{ path: TEST_IMAGE_PATH }]);
        });

        it('attachment content as a string buffer', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setAttachments(() => [
                    {
                        content: Buffer.from('hello'),
                    },
                ]);

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            const attachment = onSend.mock.calls[0][0].attachments[0].content;
            expect(Buffer.compare(attachment, Buffer.from('hello'))).toBe(0); // 0 = buffers are equal
        });

        it('attachment content as an image buffer', async () => {
            const imageFileBuffer = readFileSync(TEST_IMAGE_PATH);
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setAttachments(() => [
                    {
                        content: imageFileBuffer,
                    },
                ]);

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            const attachment = onSend.mock.calls[0][0].attachments[0].content;
            expect(Buffer.compare(attachment, imageFileBuffer)).toBe(0); // 0 = buffers are equal
        });

        it('attachment content as a string', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setAttachments(() => [
                    {
                        content: 'hello',
                    },
                ]);

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            const attachment = onSend.mock.calls[0][0].attachments[0].content;
            expect(attachment).toBe('hello');
        });

        it('attachment content as a string stream', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setAttachments(() => [
                    {
                        content: Readable.from(['hello']),
                    },
                ]);

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            const attachment = onSend.mock.calls[0][0].attachments[0].content;
            expect(Buffer.compare(attachment, Buffer.from('hello'))).toBe(0); // 0 = buffers are equal
        });

        it('attachment content as an image stream', async () => {
            const imageFileBuffer = readFileSync(TEST_IMAGE_PATH);
            const imageFileStream = createReadStream(TEST_IMAGE_PATH);
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setAttachments(() => [
                    {
                        content: imageFileStream,
                    },
                ]);

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            const attachment = onSend.mock.calls[0][0].attachments[0].content;
            expect(Buffer.compare(attachment, imageFileBuffer)).toBe(0); // 0 = buffers are equal
        });

        it('raises a warning for large content attachments', async () => {
            testingLogger.warnSpy.mockClear();
            const largeBuffer = Buffer.from(Array.from({ length: 65535, 0: 0 }));
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setAttachments(() => [
                    {
                        content: largeBuffer,
                    },
                ]);

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            expect(testingLogger.warnSpy.mock.calls[0][0]).toContain(
                "Email has a large 'content' attachment (64k). Consider using the 'path' instead for improved performance.",
            );
        });
    });

    describe('orderConfirmationHandler', () => {
        beforeEach(async () => {
            await initPluginWithHandlers([orderConfirmationHandler], {
                templateLoader: new FileBasedTemplateLoader(path.join(__dirname, '../templates')),
            });
        });

        const ctx = RequestContext.deserialize({
            _channel: { code: DEFAULT_CHANNEL_CODE },
            _languageCode: LanguageCode.en,
        } as any);

        const order = {
            code: 'ABCDE',
            customer: {
                emailAddress: 'test@test.com',
            },
            lines: [],
        } as any;

        it('filters events with wrong order state', async () => {
            await eventBus.publish(
                new OrderStateTransitionEvent('AddingItems', 'ArrangingPayment', ctx, order),
            );
            await pause();
            expect(onSend).not.toHaveBeenCalled();

            await eventBus.publish(new OrderStateTransitionEvent('AddingItems', 'Cancelled', ctx, order));
            await pause();
            expect(onSend).not.toHaveBeenCalled();

            await eventBus.publish(
                new OrderStateTransitionEvent('AddingItems', 'PaymentAuthorized', ctx, order),
            );
            await pause();
            expect(onSend).not.toHaveBeenCalled();

            await eventBus.publish(
                new OrderStateTransitionEvent('ArrangingPayment', 'PaymentSettled', ctx, order),
            );
            await pause();
            expect(onSend).toHaveBeenCalledTimes(1);
        });

        it('sets the Order Customer emailAddress as recipient', async () => {
            await eventBus.publish(
                new OrderStateTransitionEvent('ArrangingPayment', 'PaymentSettled', ctx, order),
            );
            await pause();

            expect(onSend.mock.calls[0][0].recipient).toBe(order.customer!.emailAddress);
        });

        it('sets the subject', async () => {
            await eventBus.publish(
                new OrderStateTransitionEvent('ArrangingPayment', 'PaymentSettled', ctx, order),
            );
            await pause();

            expect(onSend.mock.calls[0][0].subject).toBe(`Order confirmation for #${order.code as string}`);
        });

        it('supports BCC address', async () => {
            onSend.mockClear();
            const bccHandler = orderConfirmationHandler.setOptionalAddressFields(event => ({
                bcc: 'bcc@example.com',
            }));

            const initResult = await initPluginWithHandlers([bccHandler], {
                templateLoader: new FileBasedTemplateLoader(path.join(__dirname, '../templates')),
            });

            await eventBus.publish(
                new OrderStateTransitionEvent('ArrangingPayment', 'PaymentSettled', ctx, order),
            );
            await pause();

            expect(onSend.mock.calls[0][0].bcc).toBe('bcc@example.com');
        });
    });

    describe('error handling', () => {
        it('Logs an error if the template file is not found', async () => {
            const ctx = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.en,
            } as any);
            testingLogger.errorSpy.mockClear();

            const handler = new EmailEventListener('no-template')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}');

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(testingLogger.errorSpy.mock.calls[0][0]).toContain('ENOENT: no such file or directory');
        });

        it('Logs a Handlebars error if the template is invalid', async () => {
            const ctx = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.en,
            } as any);
            testingLogger.errorSpy.mockClear();

            const handler = new EmailEventListener('bad-template')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}');

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(testingLogger.errorSpy.mock.calls[0][0]).toContain('Parse error on line 3:');
        });

        it('Logs an error if the loadData method throws', async () => {
            const ctx = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.en,
            } as any);
            testingLogger.errorSpy.mockClear();

            const handler = new EmailEventListener('bad-template')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .loadData(context => {
                    throw new Error('something went horribly wrong!');
                });

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(testingLogger.errorSpy.mock.calls[0][0]).toContain('something went horribly wrong!');
        });
    });

    describe('custom sender', () => {
        it('should allow a custom sender to be utilized', async () => {
            const ctx = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.en,
            } as any);
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello')
                .setTemplateVars(event => ({ subjectVar: 'foo' }));

            const fakeSender = new FakeCustomSender();
            const send = vi.fn();
            fakeSender.send = send;

            await initPluginWithHandlers([handler], {
                emailSender: fakeSender,
            });

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(send.mock.calls[0][0].subject).toBe('Hello');
            expect(send.mock.calls[0][0].recipient).toBe('test@test.com');
            expect(send.mock.calls[0][0].from).toBe('"test from" <noreply@test.com>');
            expect(onSend).toHaveBeenCalledTimes(0);
        });
    });

    describe('optional address fields', () => {
        const ctx = RequestContext.deserialize({
            _channel: { code: DEFAULT_CHANNEL_CODE },
            _languageCode: LanguageCode.en,
        } as any);

        it('cc', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setOptionalAddressFields(() => ({ cc: 'foo@bar.com' }));

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            expect(onSend.mock.calls[0][0].cc).toBe('foo@bar.com');
        });

        it('bcc', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setOptionalAddressFields(() => ({ bcc: 'foo@bar.com' }));

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            expect(onSend.mock.calls[0][0].bcc).toBe('foo@bar.com');
        });

        it('replyTo', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello {{ subjectVar }}')
                .setOptionalAddressFields(() => ({ replyTo: 'foo@bar.com' }));

            await initPluginWithHandlers([handler]);
            await eventBus.publish(new MockEvent(ctx, true));
            await pause();

            expect(onSend.mock.calls[0][0].replyTo).toBe('foo@bar.com');
        });
    });

    describe('Dynamic transport settings', () => {
        let injectorArg: Injector | undefined;
        let ctxArg: RequestContext | undefined;

        it('Initializes with async transport settings', async () => {
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello')
                .setTemplateVars(event => ({ subjectVar: 'foo' }));
            module = await initPluginWithHandlers([handler], {
                transport: async (injector, _ctx) => {
                    injectorArg = injector;
                    ctxArg = _ctx;
                    return {
                        type: 'testing',
                        onSend: () => {
                            /* */
                        },
                    };
                },
            });
            const ctx = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.en,
            } as any);
            await module!.get(EventBus).publish(new MockEvent(ctx, true));
            await pause();
            expect(module).toBeDefined();
            expect(typeof module.get(EmailPlugin).options.transport).toBe('function');
        });

        it('Passes injector and context to transport function', async () => {
            const ctx = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.en,
            } as any);
            await module!.get(EventBus).publish(new MockEvent(ctx, true));
            await pause();
            expect(injectorArg?.constructor.name).toBe('Injector');
            expect(ctxArg?.constructor.name).toBe('RequestContext');
        });

        it('Resolves async transport settings', async () => {
            const transport = await module!.get(EmailProcessor).getTransportSettings();
            expect(transport.type).toBe('testing');
        });
    });

    describe('Dynamic subject handling', () => {
        it('With string', async () => {
            const ctx = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.en,
            } as any);
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject('Hello')
                .setTemplateVars(event => ({ subjectVar: 'foo' }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].subject).toBe('Hello');
            expect(onSend.mock.calls[0][0].recipient).toBe('test@test.com');
            expect(onSend.mock.calls[0][0].from).toBe('"test from" <noreply@test.com>');
        });
        it('With callback function', async () => {
            const ctx = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.en,
            } as any);
            const handler = new EmailEventListener('test')
                .on(MockEvent)
                .setFrom('"test from" <noreply@test.com>')
                .setRecipient(() => 'test@test.com')
                .setSubject(async (_e, _ctx, _i) => {
                    const service = _i.get(MockService);
                    const mockData = await service.someAsyncMethod();
                    return `Hello from ${mockData} and {{ subjectVar }}`;
                })
                .setTemplateVars(event => ({ subjectVar: 'foo' }));

            await initPluginWithHandlers([handler]);

            await eventBus.publish(new MockEvent(ctx, true));
            await pause();
            expect(onSend.mock.calls[0][0].subject).toBe('Hello from loaded data and foo');
            expect(onSend.mock.calls[0][0].recipient).toBe('test@test.com');
            expect(onSend.mock.calls[0][0].from).toBe('"test from" <noreply@test.com>');
        });
    });
    // Only in case of custom template loader - part of the jsDoc - not used in the core code
    describe('CustomLanguageAwareTemplateLoader example', () => {
        it('loads language-specific template correctly', async () => {
            class CustomLanguageAwareTemplateLoader implements TemplateLoader {
                constructor(private templateDir: string) {}

                async loadTemplate(
                    _injector: Injector,
                    context: RequestContext,
                    { type, templateName }: LoadTemplateInput,
                ) {
                    const filePath = path.join(
                        this.templateDir,
                        type,
                        `${templateName}.${context.languageCode}.hbs`,
                    );
                    return readFileSync(filePath, 'utf-8');
                }

                async loadPartials(): Promise<EmailPartial[]> {
                    return [];
                }
            }

            const templatePath = path.join(__dirname, '../test-templates');
            const loader = new CustomLanguageAwareTemplateLoader(templatePath);

            const requestContext = RequestContext.deserialize({
                _channel: { code: DEFAULT_CHANNEL_CODE },
                _languageCode: LanguageCode.de,
            } as any);

            const result = await loader.loadTemplate({} as Injector, requestContext, {
                type: 'test',
                templateName: 'body',
                templateVars: {},
            });

            expect(result).toContain('German body');
        });
    });
});

class FakeCustomSender implements EmailSender {
    send: (email: EmailDetails<'unserialized'>, options: EmailTransportOptions) => void;
}

const pause = () => new Promise(resolve => setTimeout(resolve, 100));

class MockEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public shouldSend: boolean,
    ) {
        super();
    }
}

class MockService {
    someAsyncMethod() {
        return Promise.resolve('loaded data');
    }
}
