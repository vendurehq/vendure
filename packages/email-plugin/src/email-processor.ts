import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventBus, Injector, Logger, RequestContext } from '@vendure/core';
import fs from 'fs-extra';

import { deserializeAttachments } from './attachment-utils';
import { isDevModeOptions, resolveTransportSettings } from './common';
import { EMAIL_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { EmailSendEvent } from './email-send-event';
import { EmailGenerator } from './generator/email-generator';
import { HandlebarsMjmlGenerator } from './generator/handlebars-mjml-generator';
import { EmailSender } from './sender/email-sender';
import { NodemailerEmailSender } from './sender/nodemailer-email-sender';
import {
    EmailDetails,
    EmailTransportOptions,
    InitializedEmailPluginOptions,
    IntermediateEmailDetails,
} from './types';

/**
 * This class combines the template loading, generation, and email sending - the actual "work" of
 * the EmailPlugin. It is arranged this way primarily to accommodate easier testing, so that the
 * tests can be run without needing all the JobQueue stuff which would require a full e2e test.
 */
@Injectable()
export class EmailProcessor {
    protected emailSender: EmailSender;
    protected generator: EmailGenerator;

    constructor(
        @Inject(EMAIL_PLUGIN_OPTIONS) protected options: InitializedEmailPluginOptions,
        private moduleRef: ModuleRef,
        private eventBus: EventBus,
    ) {}

    async init() {
        this.emailSender = this.options.emailSender ? this.options.emailSender : new NodemailerEmailSender();
        this.generator = this.options.emailGenerator
            ? this.options.emailGenerator
            : new HandlebarsMjmlGenerator();
        if (this.generator.onInit) {
            await this.generator.onInit.call(this.generator, this.options);
        }
        const transport = await this.getTransportSettings();
        if (transport.type === 'file') {
            // ensure the configured directory exists before
            // we attempt to write files to it
            const emailPath = transport.outputPath;
            await fs.ensureDir(emailPath);
        }
    }

    async process(data: IntermediateEmailDetails) {
        const ctx = RequestContext.deserialize(data.ctx);
        let emailDetails: EmailDetails = {} as any;
        try {
            const bodySource = await this.options.templateLoader.loadTemplate(
                new Injector(this.moduleRef),
                ctx,
                {
                    templateName: data.templateFile,
                    type: data.type,
                    templateVars: data.templateVars,
                },
            );
            const generated = await this.generator.generate(
                data.from,
                data.subject,
                bodySource,
                data.templateVars,
            );
            emailDetails = {
                ...generated,
                recipient: data.recipient,
                attachments: deserializeAttachments(data.attachments),
                cc: data.cc,
                bcc: data.bcc,
                replyTo: data.replyTo,
            };
            const transportSettings = await this.getTransportSettings(ctx);
            await this.emailSender.send(emailDetails, transportSettings);
            await this.eventBus.publish(
                new EmailSendEvent(ctx, emailDetails, true, undefined, data.metadata),
            );
            return true;
        } catch (err: unknown) {
            if (err instanceof Error) {
                Logger.error(err.message, loggerCtx, err.stack);
            } else {
                Logger.error(String(err), loggerCtx);
            }

            await this.eventBus.publish(
                new EmailSendEvent(ctx, emailDetails, false, err as Error, data.metadata),
            );
            throw err;
        }
    }

    async getTransportSettings(ctx?: RequestContext): Promise<EmailTransportOptions> {
        const transport = await resolveTransportSettings(this.options, new Injector(this.moduleRef), ctx);
        if (isDevModeOptions(this.options)) {
            if (transport && transport.type !== 'file') {
                Logger.warn(
                    `The EmailPlugin is running in dev mode. The configured '${transport.type}' transport will be replaced by the 'file' transport.`,
                    loggerCtx,
                );
            }
            return {
                type: 'file',
                raw: false,
                outputPath: this.options.outputPath,
            };
        } else {
            return transport;
        }
    }
}
