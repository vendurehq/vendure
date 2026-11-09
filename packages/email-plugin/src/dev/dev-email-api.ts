import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Channel,
    ChannelService,
    Injector,
    Job,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import express, { Request, Response, Router } from 'express';

import { EmailRenderService } from '../email-render.service';
import { EmailEventHandler } from '../handler/event-handler';
import { EmailPluginDevModeOptions, EventWithContext, IntermediateEmailDetails } from '../types';

import { DevOutbox, DevOutboxEntry } from './dev-outbox';

/**
 * The step of the email pipeline at which a dev API request failed. Reported to the caller so that it
 * knows where to look.
 */
export type DevEmailStage =
    | 'lookup'
    | 'context'
    | 'sample'
    | 'filter'
    | 'loadData'
    | 'prepare'
    | 'render'
    | 'queue';

export class DevEmailError extends Error {
    constructor(
        public stage: DevEmailStage,
        message: string,
        public statusCode = 422,
        public cause?: unknown,
    ) {
        super(message);
    }
}

export interface DevEmailApiDeps {
    options: EmailPluginDevModeOptions;
    injector: Injector;
    renderService: EmailRenderService;
    outbox: DevOutbox;
    resolveGlobalTemplateVars: (ctx: RequestContext) => Promise<Record<string, any>>;
    enqueue: (details: IntermediateEmailDetails) => Promise<void>;
}

interface EmailRequest {
    type: string;
    languageCode?: string;
    channelCode?: string;
    args?: Record<string, string>;
}

/**
 * JSON API used by the `vendure email` CLI commands (and usable by any other tool) to inspect, render
 * and send the configured emails while the EmailPlugin runs in dev mode. Mounted at `<route>/api`.
 *
 * @internal
 */
export class DevEmailApi {
    constructor(private deps: DevEmailApiDeps) {}

    router(): Router {
        const router = Router();
        router.use(express.json());
        router.get(
            '/emails',
            this.wrap(() => this.listEmails()),
        );
        router.post(
            '/render',
            this.wrap(req => this.render(req.body ?? {})),
        );
        router.post(
            '/send',
            this.wrap(req => this.send(req.body ?? {})),
        );
        router.post(
            '/check',
            this.wrap(req => this.check(req.body ?? {})),
        );
        router.get(
            '/outbox',
            this.wrap(req => this.listOutbox(req.query as Record<string, string>)),
        );
        router.get(
            '/outbox/:id',
            this.wrap(async req => {
                const entry = await this.deps.outbox.get(String(req.params.id));
                if (!entry) {
                    throw new DevEmailError(
                        'lookup',
                        `No outbox entry with id "${String(req.params.id)}"`,
                        404,
                    );
                }
                return { ok: true, entry };
            }),
        );
        return router;
    }

    listEmails() {
        return {
            ok: true,
            emails: this.deps.options.handlers.map(handler => ({
                type: handler.type,
                event: handler.event?.name,
                template: handler.template ? 'react' : 'loader-only',
                sampleData: handler.sampleEventFn ? 'database' : handler.mockEvent ? 'mock' : 'none',
            })),
        };
    }

    async render(input: EmailRequest) {
        const { handler, ctx, details, sampleSource } = await this.prepare(input);
        const rendered = await this.runStage('render', () =>
            this.deps.renderService.render(ctx, {
                type: details.type,
                from: details.from,
                subject: details.subject,
                templateVars: details.templateVars,
                templateFile: details.templateFile,
                languageCode: details.languageCode as LanguageCode,
                channelCode: details.channelCode,
            }),
        );
        return {
            ok: true,
            type: handler.type,
            languageCode: details.languageCode,
            channelCode: details.channelCode,
            sampleSource,
            email: {
                recipient: details.recipient,
                from: rendered.from,
                subject: rendered.subject,
                cc: details.cc,
                bcc: details.bcc,
                replyTo: details.replyTo,
                html: rendered.body,
                text: details.text ?? rendered.text,
                attachments: details.attachments.map(a => ({ filename: a.filename ?? undefined })),
                templateOrigin: rendered.templateOrigin,
                templateKind: rendered.templateKind,
            },
            templateVars: details.templateVars,
        };
    }

    async send(input: EmailRequest & { to?: string; waitMs?: number }) {
        const { details, sampleSource } = await this.prepare(input);
        const correlationId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const queued: IntermediateEmailDetails = {
            ...details,
            recipient: input.to ?? details.recipient,
            devCorrelationId: correlationId,
        };
        await this.runStage('queue', () => this.deps.enqueue(queued));
        const waitMs = Number(input.waitMs ?? 0);
        if (!waitMs) {
            return { ok: true, queued: true, correlationId, sampleSource };
        }
        const [entry] = await this.deps.outbox.waitFor({ correlationId }, waitMs);
        if (!entry) {
            throw new DevEmailError(
                'queue',
                `The email was queued, but no outbox entry appeared within ${waitMs}ms. ` +
                    'Is a Vendure worker running and processing the "send-email" queue?',
                504,
            );
        }
        if (entry.status === 'failed') {
            throw new DevEmailError(
                'render',
                `Sending failed in the worker: ${entry.error?.message ?? 'unknown error'}`,
                422,
                entry.error,
            );
        }
        return { ok: true, queued: true, correlationId, sampleSource, entry: summarize(entry) };
    }

    async check(input: { languageCodes?: string[]; channelCode?: string; types?: string[] }) {
        const languageCodes = input.languageCodes?.length ? input.languageCodes : [undefined];
        const results: any[] = [];
        for (const handler of this.deps.options.handlers) {
            if (input.types?.length && !input.types.includes(handler.type)) {
                continue;
            }
            for (const languageCode of languageCodes) {
                try {
                    const result = await this.render({
                        type: handler.type,
                        languageCode,
                        channelCode: input.channelCode,
                    });
                    results.push({
                        type: handler.type,
                        languageCode: result.languageCode,
                        ok: true,
                        sampleSource: result.sampleSource,
                        subject: result.email.subject,
                        templateOrigin: result.email.templateOrigin,
                    });
                } catch (e: any) {
                    const error = toErrorBody(e);
                    // Filtered sample events and missing sample data are not template errors.
                    const skipped = error.stage === 'filter' || error.stage === 'sample';
                    const { ok: _ok, ...errorFields } = error;
                    results.push({ type: handler.type, languageCode, ok: skipped, skipped, ...errorFields });
                }
            }
        }
        return { ok: results.every(r => r.ok), results };
    }

    async listOutbox(query: Record<string, string>) {
        const filter = {
            since: query.since ? parseSince(query.since) : undefined,
            recipient: query.to || undefined,
            type: query.type || undefined,
            status: (query.status as DevOutboxEntry['status']) || undefined,
            limit: query.limit ? Number(query.limit) : 20,
        };
        const waitMs = query.waitMs ? Number(query.waitMs) : 0;
        const entries = waitMs
            ? await this.deps.outbox.waitFor(filter, waitMs)
            : await this.deps.outbox.list(filter);
        const includeBody = query.include === 'body';
        return { ok: true, entries: entries.map(e => (includeBody ? e : summarize(e))) };
    }

    private async prepare(input: EmailRequest) {
        const handler = this.deps.options.handlers.find(h => h.type === input.type);
        if (!handler) {
            const types = this.deps.options.handlers.map(h => h.type).join(', ');
            throw new DevEmailError(
                'lookup',
                `No email type "${input.type}". Available types: ${types}`,
                404,
            );
        }
        const ctx = await this.runStage('context', () => this.createContext(input));
        const { event, source } = await this.runStage('sample', () =>
            this.buildSampleEvent(handler, ctx, input.args ?? {}),
        );
        const globals = await this.runStage('prepare', () => this.deps.resolveGlobalTemplateVars(ctx));
        const prepared = await this.runStage('prepare', () =>
            handler.prepare(event as any, globals, this.deps.injector),
        );
        if (prepared.status === 'filtered') {
            throw new DevEmailError(
                'filter',
                `Filter #${prepared.filterIndex + 1} of the "${handler.type}" handler rejected the ${source} sample event, ` +
                    'so this email would not be sent for it. Try another entity with --arg.',
            );
        }
        if (prepared.status === 'load-data-failed') {
            throw new DevEmailError(
                'loadData',
                `The loadData() function of the "${handler.type}" handler threw: ${errorMessage(prepared.error)}`,
                422,
                prepared.error,
            );
        }
        // In production the details pass through the job queue, which serializes them. Do the same, so that
        // templates see exactly the data they will get when the email is really sent.
        const details = new Job({ queueName: 'send-email', data: prepared.details }).data;
        return { handler, ctx, details, sampleSource: source };
    }

    private async buildSampleEvent(
        handler: EmailEventHandler<string, any>,
        ctx: RequestContext,
        args: Record<string, string>,
    ): Promise<{ event: EventWithContext; source: 'database' | 'mock' }> {
        if (handler.sampleEventFn) {
            const event = await handler.sampleEventFn({ ctx, injector: this.deps.injector, args });
            if (event) {
                return { event: event as EventWithContext, source: 'database' };
            }
        }
        if (handler.mockEvent && !Object.keys(args).length) {
            return { event: { ...handler.mockEvent, ctx } as EventWithContext, source: 'mock' };
        }
        throw new DevEmailError(
            'sample',
            handler.sampleEventFn
                ? `No sample data found for "${handler.type}"${
                      Object.keys(args).length ? ` with args ${JSON.stringify(args)}` : ''
                  }. Create matching data (e.g. place an order or register a customer) or pass different --arg values.`
                : `The "${handler.type}" handler has no sample event. Add one with .setSampleEvent().`,
        );
    }

    private async createContext(input: EmailRequest): Promise<RequestContext> {
        const channelService = this.deps.injector.get(ChannelService);
        let channel: Channel | undefined | null;
        if (input.channelCode) {
            channel = await this.deps.injector
                .get(TransactionalConnection)
                .rawConnection.getRepository(Channel)
                .findOne({ where: { code: input.channelCode } });
            if (!channel) {
                throw new DevEmailError('context', `No channel with code "${input.channelCode}"`, 404);
            }
        } else {
            channel = await channelService.getDefaultChannel();
        }
        return this.deps.injector.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: channel,
            languageCode: (input.languageCode as LanguageCode) ?? channel.defaultLanguageCode,
        });
    }

    private async runStage<T>(stage: DevEmailStage, fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (e: any) {
            if (e instanceof DevEmailError) {
                throw e;
            }
            throw new DevEmailError(stage, errorMessage(e), 422, e);
        }
    }

    private wrap(fn: (req: Request) => Promise<unknown> | unknown) {
        return async (req: Request, res: Response) => {
            try {
                res.json(await fn(req));
            } catch (e: any) {
                res.status(e instanceof DevEmailError ? e.statusCode : 500).json(toErrorBody(e));
            }
        };
    }
}

function summarize(entry: DevOutboxEntry) {
    const { html, text, ...rest } = entry;
    return { ...rest, textPreview: text?.slice(0, 500) };
}

function toErrorBody(e: any) {
    const cause = e?.cause;
    return {
        ok: false,
        stage: e instanceof DevEmailError ? e.stage : 'unknown',
        error: e?.message ?? String(e),
        stack: cause?.stack ?? (e instanceof DevEmailError ? undefined : e?.stack),
    };
}

function errorMessage(e: unknown) {
    return e instanceof Error ? e.message : String(e);
}

/**
 * Accepts an ISO date, or a duration ago such as `30s`, `5m`, `2h` or `1d`.
 */
export function parseSince(value: string): Date {
    const match = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim());
    if (match) {
        const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
        return new Date(Date.now() - Number(match[1]) * ms);
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        throw new DevEmailError(
            'lookup',
            `Invalid "since" value "${value}". Use an ISO date or e.g. 5m`,
            400,
        );
    }
    return date;
}
