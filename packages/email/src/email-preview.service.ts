import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Channel,
    ChannelService,
    Injector,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { Request } from 'express';

import { EmailDefinition } from './define-email';
import { EmailRenderService } from './email-render.service';
import { EmailService } from './email.service';
import { EventWithContext } from './types';

/**
 * @description
 * The stage at which previewing an email failed, so that the caller (often an agent) knows where to
 * look: `lookup` (unknown type), `context` (channel), `sample` (no sample data), `filter` (the
 * definition's filter rejected the sample), `data`/`recipient` (a definition function threw),
 * `render` (the template threw) or `queue`.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailPreviewService
 * @since 4.0.0
 */
export type EmailPreviewStage = 'lookup' | 'context' | 'sample' | 'filter' | 'data' | 'recipient' | 'render' | 'queue';

/**
 * @docsCategory core plugins/Email
 * @docsPage EmailPreviewService
 * @since 4.0.0
 */
export class EmailPreviewError extends Error {
    constructor(
        public readonly stage: EmailPreviewStage,
        message: string,
        public readonly statusCode = 422,
        public readonly cause?: unknown,
    ) {
        super(message);
    }
}

/**
 * @docsCategory core plugins/Email
 * @docsPage EmailPreviewService
 * @since 4.0.0
 */
export interface EmailPreviewInput {
    type: string;
    languageCode?: string;
    channelCode?: string;
    /** Passed to the definition's `sample()` function, e.g. `{ order: 'ABC123' }`. */
    args?: Record<string, string>;
}

/**
 * @description
 * Renders an email from database data, without sending it, using the definition's `sample()`
 * function. Used by the Dashboard's Emails page, the dev API and the `vendure email` CLI.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailPreviewService
 * @since 4.0.0
 */
@Injectable()
export class EmailPreviewService {
    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly emailService: EmailService,
        private readonly renderService: EmailRenderService,
    ) {}

    listEmails() {
        return this.emailService.emails.map(e => ({
            type: e.type,
            label: e.label ?? e.type,
            event: e.event?.name,
            hasSample: !!e.sample,
            canSendFromOrder: !!e.orderSend,
        }));
    }

    /**
     * @description
     * Builds the sample event, runs the definition and returns the queued job, without rendering.
     * The `req` makes asset URLs in the email absolute.
     */
    async prepare(input: EmailPreviewInput, req?: Request) {
        const definition = this.emailService.getDefinition(input.type);
        if (!definition) {
            const types = this.emailService.emails.map(e => e.type).join(', ');
            throw new EmailPreviewError('lookup', `No email type "${input.type}". Available types: ${types}`, 404);
        }
        const args = input.args ?? {};
        const ctx = await this.runStage('context', () => this.createContext(input, req));
        const event = await this.runStage('sample', () => this.buildSampleEvent(definition, ctx, args));
        const prepared = await this.emailService.prepare(definition, event);
        if (prepared.status === 'filtered') {
            throw new EmailPreviewError(
                'filter',
                `The filter of the "${definition.type}" email rejected the sample event, so this email would not be sent for it. Try other data with --arg.`,
            );
        }
        if (prepared.status === 'failed') {
            throw new EmailPreviewError(
                prepared.stage,
                `The ${prepared.stage}() function of the "${definition.type}" email threw: ${errorMessage(prepared.error)}`,
                422,
                prepared.error,
            );
        }
        return { definition, ctx, job: prepared.job, sampleArgs: args };
    }

    async render(input: EmailPreviewInput, req?: Request) {
        const { definition, ctx, job, sampleArgs } = await this.prepare(input, req);
        const rendered = await this.runStage('render', () =>
            this.renderService.render(ctx, {
                type: job.type,
                from: job.from,
                templateVars: job.templateVars,
                languageCode: job.languageCode,
                channelCode: job.channelCode,
            }),
        );
        return {
            ok: true as const,
            type: definition.type,
            label: definition.label ?? definition.type,
            languageCode: job.languageCode,
            channelCode: job.channelCode,
            sampleArgs,
            email: {
                recipient: job.recipient,
                from: rendered.from,
                subject: rendered.subject,
                cc: job.cc,
                bcc: job.bcc,
                replyTo: job.replyTo,
                html: rendered.html,
                text: rendered.text,
                attachments: job.attachments.map(a => ({ filename: a.filename ?? undefined })),
                templateOrigin: rendered.templateOrigin,
            },
            templateVars: job.templateVars,
        };
    }

    /**
     * @description
     * Renders every email (or the given types) in each language. Missing sample data, or a sample the
     * filter rejects, is reported as skipped rather than failed.
     */
    async check(input: { languageCodes?: string[]; channelCode?: string; types?: string[] }, req?: Request) {
        const languageCodes = input.languageCodes?.length ? input.languageCodes : [undefined];
        const results: any[] = [];
        for (const definition of this.emailService.emails) {
            if (input.types?.length && !input.types.includes(definition.type)) {
                continue;
            }
            for (const languageCode of languageCodes) {
                try {
                    const result = await this.render(
                        { type: definition.type, languageCode, channelCode: input.channelCode },
                        req,
                    );
                    results.push({
                        type: definition.type,
                        languageCode: result.languageCode,
                        ok: true,
                        subject: result.email.subject,
                        templateOrigin: result.email.templateOrigin,
                    });
                } catch (e: any) {
                    const error = toPreviewErrorBody(e);
                    // A sample() function that throws is a failure; no data is not.
                    const skipped =
                        e instanceof EmailPreviewError &&
                        !e.cause &&
                        (error.stage === 'filter' || error.stage === 'sample');
                    const { ok: _ok, ...errorFields } = error;
                    results.push({ type: definition.type, languageCode, ok: skipped, skipped, ...errorFields });
                }
            }
        }
        return { ok: results.every(r => r.ok), results };
    }

    private async buildSampleEvent(
        definition: EmailDefinition<any, any>,
        ctx: RequestContext,
        args: Record<string, string>,
    ): Promise<EventWithContext> {
        if (!definition.sample) {
            throw new EmailPreviewError(
                'sample',
                `The "${definition.type}" email has no sample() function, so it cannot be previewed.`,
            );
        }
        const event = await definition.sample({ ctx, injector: new Injector(this.moduleRef), args });
        if (!event) {
            const withArgs = Object.keys(args).length ? ' with args ' + JSON.stringify(args) : '';
            throw new EmailPreviewError(
                'sample',
                `No sample data found for "${definition.type}"${withArgs}. ` +
                    'Create matching data (e.g. place, ship or refund an order) or try other sample arguments.',
            );
        }
        return event;
    }

    private async createContext(input: EmailPreviewInput, req?: Request): Promise<RequestContext> {
        const injector = new Injector(this.moduleRef);
        let channel: Channel | undefined | null;
        if (input.channelCode) {
            const found = await injector
                .get(TransactionalConnection)
                .rawConnection.getRepository(Channel)
                .findOne({ where: { code: input.channelCode }, select: { id: true, token: true } });
            if (!found) {
                throw new EmailPreviewError('context', `No channel with code "${input.channelCode}"`, 404);
            }
            // The cached channel has the relations (e.g. the default tax zone) that pricing needs.
            channel = await injector.get(ChannelService).getChannelFromToken(found.token);
        } else {
            channel = await injector.get(ChannelService).getDefaultChannel();
        }
        return injector.get(RequestContextService).create({
            req,
            apiType: 'admin',
            channelOrToken: channel,
            languageCode: (input.languageCode as LanguageCode) ?? channel.defaultLanguageCode,
        });
    }

    private async runStage<T>(stage: EmailPreviewStage, fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (e: any) {
            if (e instanceof EmailPreviewError) {
                throw e;
            }
            throw new EmailPreviewError(stage, errorMessage(e), 422, e);
        }
    }
}

export function toPreviewErrorBody(e: any) {
    const cause = e?.cause;
    return {
        ok: false as const,
        stage: e instanceof EmailPreviewError ? e.stage : 'unknown',
        error: e?.message ?? String(e),
        stack: cause?.stack ?? (e instanceof EmailPreviewError ? undefined : e?.stack),
    };
}

function errorMessage(e: unknown) {
    return e instanceof Error ? e.message : String(e);
}
