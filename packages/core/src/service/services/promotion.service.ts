import { Injectable } from '@nestjs/common';
import { ApplyCouponCodeResult } from '@vendure/common/lib/generated-shop-types';
import {
    AssignPromotionsToChannelInput,
    ConfigurableOperation,
    ConfigurableOperationDefinition,
    CreatePromotionInput,
    CreatePromotionResult,
    DeletionResponse,
    DeletionResult,
    OrderType,
    RemovePromotionsFromChannelInput,
    UpdatePromotionInput,
    UpdatePromotionResult,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In, IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { ErrorResultUnion, JustErrorResults } from '../../common/error/error-result';
import { UserInputError } from '../../common/error/errors';
import { MissingConditionsError } from '../../common/error/generated-graphql-admin-errors';
import {
    CouponCodeExpiredError,
    CouponCodeInvalidError,
    CouponCodeLimitError,
} from '../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../common/instrument-decorator';
import { AdjustmentSource } from '../../common/types/adjustment-source';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { PromotionAction } from '../../config/promotion/promotion-action';
import { PromotionCondition } from '../../config/promotion/promotion-condition';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Order } from '../../entity/order/order.entity';
import { PromotionTranslation } from '../../entity/promotion/promotion-translation.entity';
import { Promotion } from '../../entity/promotion/promotion.entity';
import { EventBus } from '../../event-bus';
import { PromotionEvent } from '../../event-bus/events/promotion-event';
import { ConfigArgService } from '../helpers/config-arg/config-arg.service';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { OrderState } from '../helpers/order-state-machine/order-state';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

import { ChannelService } from './channel.service';

/**
 * @description
 * Contains methods relating to {@link Promotion} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class PromotionService {
    availableConditions: PromotionCondition[] = [];
    availableActions: PromotionAction[] = [];

    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private channelService: ChannelService,
        private listQueryBuilder: ListQueryBuilder,
        private configArgService: ConfigArgService,
        private customFieldRelationService: CustomFieldRelationService,
        private eventBus: EventBus,
        private translatableSaver: TranslatableSaver,
        private translator: TranslatorService,
    ) {
        this.availableConditions = this.configService.promotionOptions.promotionConditions || [];
        this.availableActions = this.configService.promotionOptions.promotionActions || [];
    }

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Promotion>,
        relations: RelationPaths<Promotion> = [],
    ): Promise<PaginatedList<Promotion>> {
        return this.listQueryBuilder
            .build(Promotion, options, {
                where: { deletedAt: IsNull() },
                channelId: ctx.channelId,
                relations,
                ctx,
            })
            .getManyAndCount()
            .then(([promotions, totalItems]) => {
                const items = promotions.map(promotion => this.translator.translate(promotion, ctx));
                return {
                    items,
                    totalItems,
                };
            });
    }

    async findOne(
        ctx: RequestContext,
        adjustmentSourceId: ID,
        relations: RelationPaths<Promotion> = [],
    ): Promise<Promotion | undefined> {
        return this.connection
            .findOneInChannel(ctx, Promotion, adjustmentSourceId, ctx.channelId, {
                where: { deletedAt: IsNull() },
                relations,
            })
            .then(promotion => (promotion && this.translator.translate(promotion, ctx)) ?? undefined);
    }

    getPromotionConditions(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.availableConditions.map(x => x.toGraphQlType(ctx));
    }

    getPromotionActions(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.availableActions.map(x => x.toGraphQlType(ctx));
    }

    async createPromotion(
        ctx: RequestContext,
        input: CreatePromotionInput,
    ): Promise<ErrorResultUnion<CreatePromotionResult, Promotion>> {
        const conditions = input.conditions.map(c =>
            this.configArgService.parseInput('PromotionCondition', c),
        );
        const actions = input.actions.map(a => this.configArgService.parseInput('PromotionAction', a));
        this.validateRequiredConditions(conditions, actions);
        if (conditions.length === 0 && !input.couponCode) {
            return new MissingConditionsError();
        }
        const newPromotion = await this.translatableSaver.create({
            ctx,
            input,
            entityType: Promotion,
            translationType: PromotionTranslation,
            beforeSave: async p => {
                p.priorityScore = this.calculatePriorityScore(input);
                p.conditions = conditions;
                p.actions = actions;
                await this.channelService.assignToCurrentChannel(p, ctx);
            },
        });
        const promotionWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            Promotion,
            input,
            newPromotion,
        );
        await this.eventBus.publish(new PromotionEvent(ctx, promotionWithRelations, 'created', input));
        return assertFound(this.findOne(ctx, newPromotion.id));
    }

    async updatePromotion(
        ctx: RequestContext,
        input: UpdatePromotionInput,
    ): Promise<ErrorResultUnion<UpdatePromotionResult, Promotion>> {
        const promotion = await this.connection.getEntityOrThrow(ctx, Promotion, input.id, {
            channelId: ctx.channelId,
        });

        const hasConditions = input.conditions
            ? input.conditions.length > 0
            : promotion.conditions.length > 0;
        const hasCouponCode = input.couponCode != null ? !!input.couponCode : !!promotion.couponCode;
        if (!hasConditions && !hasCouponCode) {
            return new MissingConditionsError();
        }
        const updatedPromotion = await this.translatableSaver.update({
            ctx,
            input,
            entityType: Promotion,
            translationType: PromotionTranslation,
            beforeSave: async p => {
                p.priorityScore = this.calculatePriorityScore(input);
                if (input.conditions) {
                    p.conditions = input.conditions.map(c =>
                        this.configArgService.parseInput('PromotionCondition', c),
                    );
                }
                if (input.actions) {
                    p.actions = input.actions.map(a =>
                        this.configArgService.parseInput('PromotionAction', a),
                    );
                }
            },
        });
        await this.customFieldRelationService.updateRelations(ctx, Promotion, input, updatedPromotion);
        await this.eventBus.publish(new PromotionEvent(ctx, promotion, 'updated', input));
        return assertFound(this.findOne(ctx, updatedPromotion.id));
    }

    async softDeletePromotion(ctx: RequestContext, promotionId: ID): Promise<DeletionResponse> {
        const promotion = await this.connection.getEntityOrThrow(ctx, Promotion, promotionId);
        await this.connection
            .getRepository(ctx, Promotion)
            .update({ id: promotionId }, { deletedAt: new Date() });
        await this.eventBus.publish(new PromotionEvent(ctx, promotion, 'deleted', promotionId));

        return {
            result: DeletionResult.DELETED,
        };
    }

    async assignPromotionsToChannel(
        ctx: RequestContext,
        input: AssignPromotionsToChannelInput,
    ): Promise<Promotion[]> {
        const promotions = await this.connection.findByIdsInChannel(
            ctx,
            Promotion,
            input.promotionIds,
            ctx.channelId,
            {},
        );
        for (const promotion of promotions) {
            await this.channelService.assignToChannels(ctx, Promotion, promotion.id, [input.channelId]);
        }
        return promotions.map(p => this.translator.translate(p, ctx));
    }

    async removePromotionsFromChannel(ctx: RequestContext, input: RemovePromotionsFromChannelInput) {
        const promotions = await this.connection.findByIdsInChannel(
            ctx,
            Promotion,
            input.promotionIds,
            ctx.channelId,
            {},
        );
        for (const promotion of promotions) {
            await this.channelService.removeFromChannels(ctx, Promotion, promotion.id, [input.channelId]);
        }
        return promotions.map(p => this.translator.translate(p, ctx));
    }

    /**
     * @description
     * Checks the validity of a coupon code, by checking that it is associated with an existing,
     * enabled and non-expired Promotion. Additionally, if there is a usage limit on the coupon code,
     * this method will enforce that limit against the specified Customer.
     */
    async validateCouponCode(
        ctx: RequestContext,
        couponCode: string,
        customerId?: ID,
    ): Promise<JustErrorResults<ApplyCouponCodeResult> | Promotion> {
        const promotion = await this.connection.getRepository(ctx, Promotion).findOne({
            where: {
                couponCode,
                enabled: true,
                deletedAt: IsNull(),
                channels: { id: ctx.channelId },
            },
            relations: ['channels'],
        });
        if (
            !promotion ||
            promotion.couponCode !== couponCode ||
            !promotion.channels.find(c => idsAreEqual(c.id, ctx.channelId))
        ) {
            return new CouponCodeInvalidError({ couponCode });
        }
        if (promotion.endsAt && +promotion.endsAt < +new Date()) {
            return new CouponCodeExpiredError({ couponCode });
        }
        if (customerId && promotion.perCustomerUsageLimit != null) {
            const usageCount = await this.countPromotionUsagesForCustomer(ctx, promotion.id, customerId);
            if (promotion.perCustomerUsageLimit <= usageCount) {
                return new CouponCodeLimitError({ couponCode, limit: promotion.perCustomerUsageLimit });
            }
        }
        if (promotion.usageLimit !== null) {
            const usageCount = await this.countPromotionUsages(ctx, promotion.id);
            if (promotion.usageLimit <= usageCount) {
                return new CouponCodeLimitError({ couponCode, limit: promotion.usageLimit });
            }
        }
        return promotion;
    }

    getActivePromotionsInChannel(ctx: RequestContext) {
        return this.connection
            .getRepository(ctx, Promotion)
            .createQueryBuilder('promotion')
            .leftJoin('promotion.channels', 'channel')
            .leftJoinAndSelect('promotion.translations', 'translation')
            .where('channel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('promotion.deletedAt IS NULL')
            .andWhere('promotion.enabled = :enabled', { enabled: true })
            .orderBy('promotion.priorityScore', 'ASC')
            .getMany()
            .then(promotions => promotions.map(p => this.translator.translate(p, ctx)));
    }

    async getActivePromotionsOnOrder(ctx: RequestContext, orderId: ID): Promise<Promotion[]> {
        const order = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.promotions', 'promotions')
            .where('order.id = :orderId', { orderId })
            .getOne();
        return order?.promotions ?? [];
    }

    async runPromotionSideEffects(ctx: RequestContext, order: Order, promotionsPre: Promotion[]) {
        const promotionsPost = order.promotions;
        for (const activePre of promotionsPre) {
            if (!promotionsPost.find(p => idsAreEqual(p.id, activePre.id))) {
                // activePre is no longer active, so call onDeactivate
                await activePre.deactivate(ctx, order);
            }
        }
        for (const activePost of promotionsPost) {
            if (!promotionsPre.find(p => idsAreEqual(p.id, activePost.id))) {
                // activePost was not previously active, so call onActivate
                await activePost.activate(ctx, order);
            }
        }
    }

    /**
     * @description
     * Used internally to associate a Promotion with an Order, once an Order has been placed.
     *
     * @deprecated This method is no longer used and will be removed in v2.0
     */
    async addPromotionsToOrder(ctx: RequestContext, order: Order): Promise<Order> {
        const allPromotionIds = order.discounts.map(
            a => AdjustmentSource.decodeSourceId(a.adjustmentSource).id,
        );
        const promotionIds = unique(allPromotionIds);
        const promotions = await this.connection
            .getRepository(ctx, Promotion)
            .find({ where: { id: In(promotionIds) } });
        order.promotions = promotions;
        return this.connection.getRepository(ctx, Order).save(order);
    }

    private async countPromotionUsagesForCustomer(
        ctx: RequestContext,
        promotionId: ID,
        customerId: ID,
    ): Promise<number> {
        const qb = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoin('order.promotions', 'promotion')
            .where('promotion.id = :promotionId', { promotionId })
            .andWhere('order.customer = :customerId', { customerId })
            .andWhere('order.state != :state', { state: 'Cancelled' as OrderState })
            .andWhere('order.active = :active', { active: false })
            .andWhere('order.type != :type', { type: OrderType.Seller });

        return qb.getCount();
    }

    private async countPromotionUsages(ctx: RequestContext, promotionId: ID): Promise<number> {
        const qb = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoin('order.promotions', 'promotion')
            .where('promotion.id = :promotionId', { promotionId })
            .andWhere('order.state != :state', { state: 'Cancelled' as OrderState })
            .andWhere('order.active = :active', { active: false })
            .andWhere('order.type != :type', { type: OrderType.Seller });

        return qb.getCount();
    }

    private calculatePriorityScore(input: CreatePromotionInput | UpdatePromotionInput): number {
        const conditions = input.conditions
            ? input.conditions.map(c => this.configArgService.getByCode('PromotionCondition', c.code))
            : [];
        const actions = input.actions
            ? input.actions.map(c => this.configArgService.getByCode('PromotionAction', c.code))
            : [];
        return [...conditions, ...actions].reduce((score, op) => score + op.priorityValue, 0);
    }

    private validateRequiredConditions(
        conditions: ConfigurableOperation[],
        actions: ConfigurableOperation[],
    ) {
        const conditionCodes: Record<string, string> = conditions.reduce(
            (codeMap, { code }) => ({ ...codeMap, [code]: code }),
            {},
        );
        for (const { code: actionCode } of actions) {
            const actionDef = this.configArgService.getByCode('PromotionAction', actionCode);
            const actionDependencies: PromotionCondition[] = actionDef.conditions || [];
            if (!actionDependencies || actionDependencies.length === 0) {
                continue;
            }
            const missingConditions = actionDependencies.filter(condition => !conditionCodes[condition.code]);
            if (missingConditions.length) {
                throw new UserInputError('error.conditions-required-for-action', {
                    action: actionCode,
                    conditions: missingConditions.map(c => c.code).join(', '),
                });
            }
        }
    }
}
