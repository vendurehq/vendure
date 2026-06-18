import { Injectable } from '@nestjs/common';
import { PaymentMethodQuote } from '@vendure/common/lib/generated-shop-types';
import {
    AssignPaymentMethodsToChannelInput,
    ConfigurableOperationDefinition,
    CreatePaymentMethodInput,
    DeletionResponse,
    DeletionResult,
    Permission,
    RemovePaymentMethodsFromChannelInput,
    UpdatePaymentMethodInput,
} from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { ForbiddenError, UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { PaymentMethodEligibilityChecker } from '../../config/payment/payment-method-eligibility-checker';
import { PaymentMethodHandler } from '../../config/payment/payment-method-handler';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Order } from '../../entity/order/order.entity';
import { PaymentMethodTranslation } from '../../entity/payment-method/payment-method-translation.entity';
import { PaymentMethod } from '../../entity/payment-method/payment-method.entity';
import { EventBus } from '../../event-bus/event-bus';
import { PaymentMethodEvent } from '../../event-bus/events/payment-method-event';
import { ConfigArgService } from '../helpers/config-arg/config-arg.service';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

import { ChannelService } from './channel.service';
import { RoleService } from './role.service';

/**
 * @description
 * Contains methods relating to {@link PaymentMethod} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class PaymentMethodService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private roleService: RoleService,
        private listQueryBuilder: ListQueryBuilder,
        private eventBus: EventBus,
        private configArgService: ConfigArgService,
        private channelService: ChannelService,
        private customFieldRelationService: CustomFieldRelationService,
        private translatableSaver: TranslatableSaver,
        private translator: TranslatorService,
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<PaymentMethod>,
        relations: RelationPaths<PaymentMethod> = [],
    ): Promise<PaginatedList<PaymentMethod>> {
        return this.listQueryBuilder
            .build(PaymentMethod, options, { ctx, relations, channelId: ctx.channelId })
            .getManyAndCount()
            .then(([methods, totalItems]) => {
                const items = methods.map(m => this.translator.translate(m, ctx));
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(
        ctx: RequestContext,
        paymentMethodId: ID,
        relations: RelationPaths<PaymentMethod> = [],
    ): Promise<PaymentMethod | undefined> {
        return this.connection
            .findOneInChannel(ctx, PaymentMethod, paymentMethodId, ctx.channelId, {
                relations,
            })
            .then(paymentMethod => {
                if (paymentMethod) {
                    return this.translator.translate(paymentMethod, ctx);
                }
            });
    }

    async create(ctx: RequestContext, input: CreatePaymentMethodInput): Promise<PaymentMethod> {
        const savedPaymentMethod = await this.translatableSaver.create({
            ctx,
            input,
            entityType: PaymentMethod,
            translationType: PaymentMethodTranslation,
            beforeSave: async pm => {
                pm.handler = this.configArgService.parseInput('PaymentMethodHandler', input.handler);
                if (input.checker) {
                    pm.checker = this.configArgService.parseInput(
                        'PaymentMethodEligibilityChecker',
                        input.checker,
                    );
                }
                await this.channelService.assignToCurrentChannel(pm, ctx);
            },
        });
        await this.customFieldRelationService.updateRelations(ctx, PaymentMethod, input, savedPaymentMethod);
        await this.eventBus.publish(new PaymentMethodEvent(ctx, savedPaymentMethod, 'created', input));
        return assertFound(this.findOne(ctx, savedPaymentMethod.id));
    }

    async update(ctx: RequestContext, input: UpdatePaymentMethodInput): Promise<PaymentMethod> {
        // Ensure the entity belongs to the active channel before updating.
        await this.connection.getEntityOrThrow(ctx, PaymentMethod, input.id, { channelId: ctx.channelId });
        const updatedPaymentMethod = await this.translatableSaver.update({
            ctx,
            input,
            entityType: PaymentMethod,
            translationType: PaymentMethodTranslation,
            beforeSave: async pm => {
                if (input.checker) {
                    pm.checker = this.configArgService.parseInput(
                        'PaymentMethodEligibilityChecker',
                        input.checker,
                    );
                }
                if (input.checker === null) {
                    pm.checker = null;
                }
                if (input.handler) {
                    pm.handler = this.configArgService.parseInput('PaymentMethodHandler', input.handler);
                }
            },
        });
        await this.customFieldRelationService.updateRelations(
            ctx,
            PaymentMethod,
            input,
            updatedPaymentMethod,
        );
        await this.connection.getRepository(ctx, PaymentMethod).save(updatedPaymentMethod, { reload: false });
        await this.eventBus.publish(new PaymentMethodEvent(ctx, updatedPaymentMethod, 'updated', input));
        return assertFound(this.findOne(ctx, updatedPaymentMethod.id));
    }

    async delete(
        ctx: RequestContext,
        paymentMethodId: ID,
        force: boolean = false,
    ): Promise<DeletionResponse> {
        const paymentMethod = await this.connection.getEntityOrThrow(ctx, PaymentMethod, paymentMethodId, {
            relations: ['channels'],
            channelId: ctx.channelId,
        });
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) {
            const nonDefaultChannels = paymentMethod.channels.filter(
                channel => channel.code !== DEFAULT_CHANNEL_CODE,
            );
            if (0 < nonDefaultChannels.length && !force) {
                const message = ctx.translate('message.payment-method-used-in-channels', {
                    channelCodes: nonDefaultChannels.map(c => c.code).join(', '),
                });
                const result = DeletionResult.NOT_DELETED;
                return { result, message };
            }
            try {
                const deletedPaymentMethod = new PaymentMethod(paymentMethod);
                await this.connection.getRepository(ctx, PaymentMethod).remove(paymentMethod);
                await this.eventBus.publish(
                    new PaymentMethodEvent(ctx, deletedPaymentMethod, 'deleted', paymentMethodId),
                );
                return {
                    result: DeletionResult.DELETED,
                };
            } catch (e: any) {
                return {
                    result: DeletionResult.NOT_DELETED,
                    message: e.message || String(e),
                };
            }
        } else {
            // If not deleting from the default channel, we will not actually delete,
            // but will remove from the current channel
            paymentMethod.channels = paymentMethod.channels.filter(c => !idsAreEqual(c.id, ctx.channelId));
            await this.connection.getRepository(ctx, PaymentMethod).save(paymentMethod);
            await this.eventBus.publish(
                new PaymentMethodEvent(ctx, paymentMethod, 'deleted', paymentMethodId),
            );
            return {
                result: DeletionResult.DELETED,
            };
        }
    }

    async assignPaymentMethodsToChannel(
        ctx: RequestContext,
        input: AssignPaymentMethodsToChannelInput,
    ): Promise<Array<Translated<PaymentMethod>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.UpdatePaymentMethod,
            Permission.UpdateSettings,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        for (const paymentMethodId of input.paymentMethodIds) {
            const paymentMethod = await this.connection.findOneInChannel(
                ctx,
                PaymentMethod,
                paymentMethodId,
                ctx.channelId,
            );
            await this.channelService.assignToChannels(ctx, PaymentMethod, paymentMethodId, [
                input.channelId,
            ]);
        }
        return this.connection
            .findByIdsInChannel(ctx, PaymentMethod, input.paymentMethodIds, ctx.channelId, {})
            .then(methods => methods.map(method => this.translator.translate(method, ctx)));
    }

    async removePaymentMethodsFromChannel(
        ctx: RequestContext,
        input: RemovePaymentMethodsFromChannelInput,
    ): Promise<Array<Translated<PaymentMethod>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.DeletePaymentMethod,
            Permission.DeleteSettings,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(input.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        for (const paymentMethodId of input.paymentMethodIds) {
            const paymentMethod = await this.connection.getEntityOrThrow(ctx, PaymentMethod, paymentMethodId);
            await this.channelService.removeFromChannels(ctx, PaymentMethod, paymentMethodId, [
                input.channelId,
            ]);
        }
        return this.connection
            .findByIdsInChannel(ctx, PaymentMethod, input.paymentMethodIds, ctx.channelId, {})
            .then(methods => methods.map(method => this.translator.translate(method, ctx)));
    }

    getPaymentMethodEligibilityCheckers(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService
            .getDefinitions('PaymentMethodEligibilityChecker')
            .map(x => x.toGraphQlType(ctx));
    }

    getPaymentMethodHandlers(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService.getDefinitions('PaymentMethodHandler').map(x => x.toGraphQlType(ctx));
    }

    async getEligiblePaymentMethods(ctx: RequestContext, order: Order): Promise<PaymentMethodQuote[]> {
        const paymentMethods = await this.connection
            .getRepository(ctx, PaymentMethod)
            .find({ where: { enabled: true }, relations: ['channels'] });
        const results: PaymentMethodQuote[] = [];
        const paymentMethodsInChannel = paymentMethods
            .filter(p => p.channels.find(pc => idsAreEqual(pc.id, ctx.channelId)))
            .map(p => this.translator.translate(p, ctx));
        for (const method of paymentMethodsInChannel) {
            let isEligible = true;
            let eligibilityMessage: string | undefined;
            if (method.checker) {
                const checker = this.configArgService.getByCode(
                    'PaymentMethodEligibilityChecker',
                    method.checker.code,
                );
                const eligible = await checker.check(ctx, order, method.checker.args, method);
                if (eligible === false || typeof eligible === 'string') {
                    isEligible = false;
                    eligibilityMessage = typeof eligible === 'string' ? eligible : undefined;
                }
            }

            results.push({
                id: method.id,
                code: method.code,
                name: method.name,
                description: method.description,
                isEligible,
                eligibilityMessage,
                customFields: method.customFields,
            });
        }
        return results;
    }

    async getMethodAndOperations(
        ctx: RequestContext,
        method: string,
    ): Promise<{
        paymentMethod: PaymentMethod;
        handler: PaymentMethodHandler;
        checker: PaymentMethodEligibilityChecker | null;
    }> {
        const paymentMethod = await this.connection
            .getRepository(ctx, PaymentMethod)
            .createQueryBuilder('method')
            .leftJoin('method.channels', 'channel')
            .where('method.code = :code', { code: method })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('method.enabled IS true')
            .getOne();
        if (!paymentMethod) {
            throw new UserInputError('error.payment-method-not-found', { method });
        }
        const handler = this.configArgService.getByCode('PaymentMethodHandler', paymentMethod.handler.code);
        const checker =
            paymentMethod.checker &&
            this.configArgService.getByCode('PaymentMethodEligibilityChecker', paymentMethod.checker.code);
        return { paymentMethod, handler, checker };
    }

    async getActivePaymentMethods(ctx: RequestContext): Promise<PaymentMethod[]> {
        const paymentMethods = await this.connection.getRepository(ctx, PaymentMethod).find({
            where: { enabled: true, channels: { id: ctx.channelId } },
            relations: ['channels', 'customFields'],
        });
        return paymentMethods.map(p => this.translator.translate(p, ctx));
    }
}
