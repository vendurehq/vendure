import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Injector, Job, JobQueue, JobQueueService, RequestContext } from '@vendure/core';

import { EMAIL_OPTIONS, SEND_EMAIL_QUEUE } from './constants';
import { EmailDefinition, prepareEmail, PrepareEmailResult } from './define-email';
import { EmailProcessor } from './email-processor';
import { EmailJobData, EventWithContext, GlobalTemplateVars, InitializedEmailPluginOptions } from './types';

/**
 * @description
 * Prepares and queues emails. Automatic sends, sends from the dashboard and the dev tooling all go
 * through it.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
@Injectable()
export class EmailService {
    private jobQueue: JobQueue<EmailJobData> | undefined;
    private directProcessor: EmailProcessor | undefined;

    constructor(
        @Inject(EMAIL_OPTIONS) private options: InitializedEmailPluginOptions,
        private moduleRef: ModuleRef,
        private jobQueueService: JobQueueService,
    ) {}

    /** @internal */
    async init(processor: EmailProcessor, useQueue: boolean) {
        if (useQueue) {
            this.jobQueue = await this.jobQueueService.createQueue({
                name: SEND_EMAIL_QUEUE,
                process: job => processor.process(job.data),
            });
        } else {
            this.directProcessor = processor;
        }
    }

    get emails(): Array<EmailDefinition<any, any>> {
        return this.options.emails;
    }

    getDefinition(type: string): EmailDefinition<any, any> | undefined {
        return this.options.emails.find(e => e.type === type);
    }

    async resolveGlobalTemplateVars(ctx: RequestContext): Promise<GlobalTemplateVars> {
        const globals = this.options.globalTemplateVars;
        if (typeof globals === 'function') {
            return globals(ctx, new Injector(this.moduleRef));
        }
        return globals ?? {};
    }

    /**
     * @description
     * Runs the definition for the event. The job in the result has been through JSON serialisation,
     * so it holds exactly what the template will receive in the worker.
     */
    async prepare(
        definition: EmailDefinition<any, any>,
        event: EventWithContext,
        options: { skipFilter?: boolean } = {},
    ): Promise<PrepareEmailResult> {
        const result = await prepareEmail(definition, event, {
            injector: new Injector(this.moduleRef),
            globals: await this.resolveGlobalTemplateVars(event.ctx),
            defaultFrom: this.options.defaultFrom,
            skipFilter: options.skipFilter,
        });
        if (result.status === 'ready') {
            return { ...result, job: new Job({ queueName: SEND_EMAIL_QUEUE, data: result.job }).data };
        }
        return result;
    }

    async enqueue(job: EmailJobData): Promise<void> {
        if (this.jobQueue) {
            await this.jobQueue.add(job, { retries: 5 });
        } else if (this.directProcessor) {
            await this.directProcessor.process(job);
        } else {
            throw new Error('The EmailPlugin has not finished bootstrapping, so the email cannot be queued yet');
        }
    }
}
