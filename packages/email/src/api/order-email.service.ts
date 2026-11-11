import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ID,
    Injector,
    Order,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';

import { EmailDefinition, OrderEmailTarget } from '../define-email';
import { EmailRenderService } from '../email-render.service';
import { EmailService } from '../email.service';
import { loadOrderForEmail } from '../emails/order-helpers';
import { EmailJobData } from '../types';

export interface OrderEmailOption {
    type: string;
    label: string;
    targets: OrderEmailTarget[];
}

export interface OrderEmailInput {
    orderId: ID;
    type: string;
    targetId: string;
    languageCode?: LanguageCode;
}

/**
 * @description
 * Lists, previews and sends the emails of an order from the dashboard. An email can only be sent for
 * a target (the order, a fulfillment, a payment or a refund) whose current state allows it, as
 * decided by the `orderSend.targets()` function of the email definition.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
@Injectable()
export class OrderEmailService {
    constructor(
        private moduleRef: ModuleRef,
        private emailService: EmailService,
        private renderService: EmailRenderService,
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
    ) {}

    async listForOrder(ctx: RequestContext, orderId: ID): Promise<{ recipient?: string; emails: OrderEmailOption[] }> {
        const order = await loadOrderForEmail(ctx, this.injector, orderId);
        const emails: OrderEmailOption[] = [];
        for (const definition of this.emailService.emails) {
            if (!definition.orderSend) {
                continue;
            }
            emails.push({
                type: definition.type,
                label: definition.label ?? definition.type,
                targets: await definition.orderSend.targets({ ctx, injector: this.injector, order }),
            });
        }
        return { recipient: order.customer?.emailAddress, emails };
    }

    async preview(ctx: RequestContext, input: OrderEmailInput) {
        const { job } = await this.prepare(ctx, input);
        const rendered = await this.renderService.render(ctx, {
            type: job.type,
            from: job.from,
            templateVars: job.templateVars,
            languageCode: job.languageCode,
            channelCode: job.channelCode,
        });
        return {
            recipient: job.recipient,
            from: rendered.from,
            subject: rendered.subject,
            html: rendered.html,
            templateOrigin: rendered.templateOrigin,
        };
    }

    async send(ctx: RequestContext, input: OrderEmailInput & { recipient?: string }) {
        const { job, target } = await this.prepare(ctx, input);
        const queued: EmailJobData = {
            ...job,
            recipient: input.recipient?.trim() || job.recipient,
            metadata: { ...job.metadata, orderId: input.orderId, targetLabel: target.label, sentManually: true },
        };
        await this.emailService.enqueue(queued);
        return { success: true, recipient: queued.recipient };
    }

    private async prepare(ctx: RequestContext, input: OrderEmailInput) {
        const definition = this.getOrderEmail(input.type);
        const emailCtx = await this.createEmailContext(ctx, input.languageCode);
        const order = await loadOrderForEmail(emailCtx, this.injector, input.orderId);
        const target = await this.getEligibleTarget(emailCtx, definition, order, input.targetId);
        const event = await this.orderSend(definition).createEvent({
            ctx: emailCtx,
            injector: this.injector,
            order,
            targetId: input.targetId,
        });
        const result = await this.emailService.prepare(definition, event);
        if (result.status === 'filtered') {
            throw new UserInputError(`The filter of the "${definition.type}" email rejected this send`);
        }
        if (result.status === 'failed') {
            const message = result.error instanceof Error ? result.error.message : String(result.error);
            throw new UserInputError(`Could not prepare the email (${result.stage}): ${message}`);
        }
        return { job: result.job, target };
    }

    private getOrderEmail(type: string): EmailDefinition<any, any> {
        const definition = this.emailService.getDefinition(type);
        if (!definition?.orderSend) {
            throw new UserInputError(`There is no order email of type "${type}"`);
        }
        return definition;
    }

    private async getEligibleTarget(
        ctx: RequestContext,
        definition: EmailDefinition<any, any>,
        order: Order,
        targetId: string,
    ): Promise<OrderEmailTarget> {
        const targets = await this.orderSend(definition).targets({ ctx, injector: this.injector, order });
        const target = targets.find(t => t.id === targetId);
        if (!target) {
            throw new UserInputError(`"${definition.type}" cannot be sent for target "${targetId}" of this order`);
        }
        if (!target.eligible) {
            throw new UserInputError(target.reason ?? `"${definition.type}" cannot be sent in the current state`);
        }
        return target;
    }

    /**
     * The admin's RequestContext carries the admin's UI language. Emails go to the customer, so they
     * use the channel's default language unless one is given.
     */
    private async createEmailContext(ctx: RequestContext, languageCode?: LanguageCode): Promise<RequestContext> {
        const user = ctx.activeUserId
            ? await this.connection.getRepository(ctx, User).findOne({ where: { id: ctx.activeUserId } })
            : undefined;
        return this.requestContextService.create({
            req: ctx.req,
            apiType: 'admin',
            channelOrToken: ctx.channel,
            languageCode: languageCode ?? ctx.channel.defaultLanguageCode,
            user: user ?? undefined,
        });
    }

    private orderSend(definition: EmailDefinition<any, any>) {
        if (!definition.orderSend) {
            throw new UserInputError(`"${definition.type}" cannot be sent from the order page`);
        }
        return definition.orderSend;
    }

    private get injector() {
        return new Injector(this.moduleRef);
    }
}
