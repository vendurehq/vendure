import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import { EventBus, HistoryService, Injector, Logger, RequestContext } from '@vendure/core';
import fs from 'fs-extra';

import { deserializeAttachments } from './attachment-utils';
import { isDevModeOptions, resolveTransportSettings } from './common';
import { EMAIL_OPTIONS, loggerCtx } from './constants';
import { DevOutbox, getDevOutboxDir } from './dev/dev-outbox';
import { EmailRenderService, EmailTemplateOrigin } from './email-render.service';
import { EmailSendEvent } from './email-send-event';
import { EmailSender } from './sender/email-sender';
import { NodemailerEmailSender } from './sender/nodemailer-email-sender';
import { EmailDetails, EmailJobData, EmailTransportOptions, InitializedEmailPluginOptions } from './types';

/**
 * Renders and sends a queued email. Runs in the worker.
 */
@Injectable()
export class EmailProcessor {
    protected emailSender: EmailSender;
    private devOutbox: DevOutbox | undefined;

    constructor(
        @Inject(EMAIL_OPTIONS) protected readonly options: InitializedEmailPluginOptions,
        private readonly moduleRef: ModuleRef,
        private readonly eventBus: EventBus,
        private readonly renderService: EmailRenderService,
        private readonly historyService: HistoryService,
    ) {}

    async init() {
        this.emailSender = this.options.emailSender ?? new NodemailerEmailSender();
        if (isDevModeOptions(this.options)) {
            this.devOutbox = new DevOutbox(getDevOutboxDir(this.options.outputPath));
        }
        const transport = await this.getTransportSettings();
        if (transport.type === 'file') {
            await fs.ensureDir(transport.outputPath);
        }
    }

    async process(data: EmailJobData) {
        const ctx = RequestContext.deserialize(data.ctx);
        let email: EmailDetails = {} as any;
        let templateOrigin: EmailTemplateOrigin | undefined;
        try {
            const rendered = await this.renderService.render(ctx, {
                type: data.type,
                from: data.from,
                templateVars: data.templateVars,
                languageCode: data.languageCode,
                channelCode: data.channelCode,
                contentDraft: data.test?.contentDraft,
                designDraft: data.test?.designDraft,
            });
            templateOrigin = rendered.templateOrigin;
            email = {
                from: rendered.from,
                subject: data.test ? `[Test] ${rendered.subject}` : rendered.subject,
                body: rendered.html,
                text: rendered.text,
                recipient: data.recipient,
                attachments: deserializeAttachments(data.attachments),
                cc: data.cc,
                bcc: data.bcc,
                replyTo: data.replyTo,
            };
            await this.emailSender.send(email, await this.getTransportSettings(ctx));
            await this.recordInDevOutbox(data, email, templateOrigin);
            await this.addOrderHistoryEntry(ctx, data, email);
            await this.eventBus.publish(new EmailSendEvent(ctx, email, true, undefined, data.metadata));
            return true;
        } catch (err: unknown) {
            if (err instanceof Error) {
                Logger.error(err.message, loggerCtx, err.stack);
            } else {
                Logger.error(String(err), loggerCtx);
            }
            await this.recordInDevOutbox(data, email, templateOrigin, err);
            await this.eventBus.publish(new EmailSendEvent(ctx, email, false, err as Error, data.metadata));
            throw err;
        }
    }

    async getTransportSettings(ctx?: RequestContext): Promise<EmailTransportOptions> {
        if (isDevModeOptions(this.options)) {
            return { type: 'file', raw: false, outputPath: this.options.outputPath };
        }
        return resolveTransportSettings(this.options, new Injector(this.moduleRef), ctx);
    }

    private async addOrderHistoryEntry(ctx: RequestContext, data: EmailJobData, email: EmailDetails) {
        const orderId = data.metadata?.orderId;
        // A test email isn't about the order it borrowed its data from.
        if (this.options.orderHistory === false || orderId == null || data.test) {
            return;
        }
        const label = this.options.emails.find(e => e.type === data.type)?.label ?? data.type;
        const target = data.metadata?.targetLabel ? ` (${String(data.metadata.targetLabel)})` : '';
        const manual = data.metadata?.sentManually ? ', sent manually' : '';
        try {
            await this.historyService.createHistoryEntryForOrder(
                {
                    ctx,
                    orderId,
                    type: HistoryEntryType.ORDER_NOTE,
                    data: { note: `Email "${label}"${target} sent to ${email.recipient}${manual}` },
                },
                false,
            );
        } catch (e: any) {
            Logger.warn(`Could not add the email to the order history: ${String(e?.message)}`, loggerCtx);
        }
    }

    private async recordInDevOutbox(
        data: EmailJobData,
        email: Partial<EmailDetails>,
        templateOrigin: string | undefined,
        error?: unknown,
    ) {
        if (!this.devOutbox) {
            return;
        }
        try {
            await this.devOutbox.record({
                status: error ? 'failed' : 'sent',
                type: data.type,
                recipient: email.recipient ?? data.recipient,
                from: email.from ?? data.from,
                subject: email.subject,
                cc: email.cc ?? data.cc,
                bcc: email.bcc ?? data.bcc,
                replyTo: email.replyTo ?? data.replyTo,
                html: email.body,
                text: email.text,
                attachments: (email.attachments ?? data.attachments ?? []).map(a => ({
                    filename: a.filename || undefined,
                })),
                metadata: data.metadata,
                languageCode: data.languageCode,
                channelCode: data.channelCode,
                correlationId: data.devCorrelationId,
                templateOrigin,
                error: toOutboxError(error),
            });
        } catch (e: any) {
            Logger.warn(`Could not write to the dev outbox: ${String(e?.message ?? e)}`, loggerCtx);
        }
    }
}

function toOutboxError(error: unknown): { message: string; stack?: string } | undefined {
    if (error === undefined) {
        return undefined;
    }
    if (error instanceof Error) {
        return { message: error.message, stack: error.stack };
    }
    return { message: typeof error === 'string' ? error : JSON.stringify(error) };
}
