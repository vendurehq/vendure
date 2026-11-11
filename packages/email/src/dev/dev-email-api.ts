import express, { Request, Response, Router } from 'express';

import { EmailPreviewError, EmailPreviewInput, EmailPreviewService, toPreviewErrorBody } from '../email-preview.service';
import { EmailService } from '../email.service';
import { EmailJobData } from '../types';

import { DevOutbox, DevOutboxEntry } from './dev-outbox';

/**
 * The dev mode HTTP endpoints, mounted at the `route` of the dev mode options. People use the Emails
 * page of the Dashboard (System > Emails). These endpoints serve the `vendure email` CLI (`/api`) and
 * agents taking screenshots of a rendered email (`/preview/:type/html`), so they need no login.
 */
export class DevEmailApi {
    constructor(
        private readonly deps: {
            emailService: EmailService;
            previewService: EmailPreviewService;
            outbox: DevOutbox;
            dashboardRoute?: string;
        },
    ) {}

    router(): Router {
        const router = Router();
        const api = Router();
        api.use(express.json());
        api.get(
            '/emails',
            this.json(() => ({ ok: true, emails: this.deps.previewService.listEmails() })),
        );
        api.post(
            '/render',
            this.json(req => this.deps.previewService.render(req.body ?? {}, req)),
        );
        api.post(
            '/send',
            this.json(req => this.send(req.body ?? {}, req)),
        );
        api.post(
            '/check',
            this.json(req => this.deps.previewService.check(req.body ?? {}, req)),
        );
        api.get(
            '/outbox',
            this.json(req => this.listOutbox(req.query as Record<string, string>)),
        );
        api.get(
            '/outbox/:id',
            this.json(async req => {
                const entry = await this.deps.outbox.get(String(req.params.id));
                if (!entry) {
                    throw new EmailPreviewError('lookup', `No outbox entry with id "${String(req.params.id)}"`, 404);
                }
                return { ok: true, entry };
            }),
        );
        router.use('/api', api);

        router.get('/', (_req, res) => {
            res.type('text').send(
                'Emails are previewed in the Dashboard: System > Emails' +
                    (this.deps.dashboardRoute ? ` (/${this.deps.dashboardRoute}/emails)` : '') +
                    '.\nThe `vendure email` CLI uses ./api, and ./preview/<type>/html serves the rendered HTML of an email.\n',
            );
        });
        router.get('/preview/:type/html', async (req, res) => {
            const { language, channel, ...args } = req.query as Record<string, string>;
            const input: EmailPreviewInput = {
                type: String(req.params.type),
                languageCode: language,
                channelCode: channel,
                args,
            };
            try {
                const result = await this.deps.previewService.render(input, req);
                res.type('html').send(result.email.html);
            } catch (e: any) {
                const body = toPreviewErrorBody(e);
                res.status(e instanceof EmailPreviewError ? e.statusCode : 500)
                    .type('text')
                    .send(`Rendering failed at stage "${body.stage}": ${String(body.error)}\n\n${body.stack ?? ''}`);
            }
        });
        router.get('/outbox/:id/html', async (req, res) => {
            const entry = await this.deps.outbox.get(String(req.params.id));
            if (!entry?.html) {
                res.status(404).type('text').send('No HTML for this outbox entry');
                return;
            }
            res.type('html').send(entry.html);
        });
        return router;
    }

    async send(input: EmailPreviewInput & { to?: string; waitMs?: number }, req?: Request) {
        const { job } = await this.deps.previewService.prepare(input, req);
        const correlationId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const queued: EmailJobData = { ...job, recipient: input.to ?? job.recipient, devCorrelationId: correlationId };
        try {
            await this.deps.emailService.enqueue(queued);
        } catch (e: any) {
            throw new EmailPreviewError('queue', String(e?.message ?? e), 422, e);
        }
        const waitMs = Number(input.waitMs ?? 0);
        if (!waitMs) {
            return { ok: true, queued: true, correlationId };
        }
        const [entry] = await this.deps.outbox.waitFor({ correlationId }, waitMs);
        if (!entry) {
            throw new EmailPreviewError(
                'queue',
                `The email was queued, but no outbox entry appeared within ${waitMs}ms. ` +
                    'Is a Vendure worker running and processing the "send-email" queue?',
                504,
            );
        }
        if (entry.status === 'failed') {
            throw new EmailPreviewError(
                'render',
                `Sending failed in the worker: ${entry.error?.message ?? 'unknown error'}`,
                422,
                entry.error,
            );
        }
        return { ok: true, queued: true, correlationId, entry: summarizeOutboxEntry(entry) };
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
        const entries = waitMs ? await this.deps.outbox.waitFor(filter, waitMs) : await this.deps.outbox.list(filter);
        const includeBody = query.include === 'body';
        return { ok: true, entries: entries.map(e => (includeBody ? e : summarizeOutboxEntry(e))) };
    }

    private json(fn: (req: Request) => unknown) {
        return async (req: Request, res: Response) => {
            try {
                res.json(await fn(req));
            } catch (e: any) {
                res.status(e instanceof EmailPreviewError ? e.statusCode : 500).json(toPreviewErrorBody(e));
            }
        };
    }
}

export function summarizeOutboxEntry(entry: DevOutboxEntry) {
    const { html, text, ...rest } = entry;
    return { ...rest, textPreview: text?.slice(0, 500) };
}

export function parseSince(value: string): Date {
    const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
    if (match) {
        const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
        return new Date(Date.now() - Number(match[1]) * ms);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new EmailPreviewError('lookup', `Invalid "since" value "${value}". Use an ISO date or e.g. 5m`, 400);
    }
    return date;
}
