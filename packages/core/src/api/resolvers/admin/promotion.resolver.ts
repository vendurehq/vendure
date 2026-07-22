import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    CreatePromotionResult,
    DeletionResponse,
    MutationAssignPromotionsToChannelArgs,
    MutationCreatePromotionArgs,
    MutationDeletePromotionArgs,
    MutationDeletePromotionsArgs,
    MutationRemovePromotionsFromChannelArgs,
    MutationUpdatePromotionArgs,
    Permission,
    QueryPromotionArgs,
    QueryPromotionsArgs,
    UpdatePromotionResult,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { ErrorResultUnion } from '../../../common/error/error-result';
import { PromotionItemAction, PromotionOrderAction } from '../../../config/promotion/promotion-action';
import { PromotionCondition } from '../../../config/promotion/promotion-condition';
import { Promotion } from '../../../entity/promotion/promotion.entity';
import { PromotionService } from '../../../service/services/promotion.service';
import { ConfigurableOperationCodec } from '../../common/configurable-operation-codec';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('Promotion')
export class PromotionResolver {
    constructor(
        private promotionService: PromotionService,
        private configurableOperationCodec: ConfigurableOperationCodec,
    ) {}

    @Query()
    @Allow(Permission.ReadPromotion)
    promotions(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryPromotionsArgs,
        @Relations(Promotion) relations: RelationPaths<Promotion>,
    ): Promise<PaginatedList<Promotion>> {
        return this.promotionService.findAll(ctx, args.options || undefined, relations).then(res => {
            res.items.forEach(this.encodeConditionsAndActions);
            return res;
        });
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    promotion(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryPromotionArgs,
        @Relations(Promotion) relations: RelationPaths<Promotion>,
    ): Promise<Promotion | undefined> {
        return this.promotionService.findOne(ctx, args.id, relations).then(this.encodeConditionsAndActions);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    promotionConditions(@Ctx() ctx: RequestContext) {
        return this.promotionService.getPromotionConditions(ctx);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    promotionActions(@Ctx() ctx: RequestContext) {
        return this.promotionService.getPromotionActions(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreatePromotion)
    createPromotion(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreatePromotionArgs,
    ): Promise<ErrorResultUnion<CreatePromotionResult, Promotion>> {
        // Note: PromotionItemAction and PromotionOrderAction share the same
        // pool of action defs in getAvailableDefsOfType(), so a single call
        // with either type will decode ID args for all promotion actions.
        this.configurableOperationCodec.decodeConfigurableOperationIds(
            PromotionItemAction,
            args.input.actions,
        );
        this.configurableOperationCodec.decodeConfigurableOperationIds(
            PromotionCondition,
            args.input.conditions,
        );
        return this.promotionService.createPromotion(ctx, args.input).then(this.encodeConditionsAndActions);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    updatePromotion(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdatePromotionArgs,
    ): Promise<ErrorResultUnion<UpdatePromotionResult, Promotion>> {
        // Note: PromotionItemAction and PromotionOrderAction share the same
        // pool of action defs in getAvailableDefsOfType(), so a single call
        // with either type will decode ID args for all promotion actions.
        // Calling decode twice on the same input array would cause double-decoding,
        // which breaks custom EntityIdStrategies (e.g. hashed IDs).
        this.configurableOperationCodec.decodeConfigurableOperationIds(
            PromotionItemAction,
            args.input.actions || [],
        );
        this.configurableOperationCodec.decodeConfigurableOperationIds(
            PromotionCondition,
            args.input.conditions || [],
        );
        return this.promotionService.updatePromotion(ctx, args.input).then(this.encodeConditionsAndActions);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeletePromotion)
    deletePromotion(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeletePromotionArgs,
    ): Promise<DeletionResponse> {
        return this.promotionService.softDeletePromotion(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeletePromotion)
    deletePromotions(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeletePromotionsArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.promotionService.softDeletePromotion(ctx, id)));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    assignPromotionsToChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignPromotionsToChannelArgs,
    ): Promise<Promotion[]> {
        return this.promotionService.assignPromotionsToChannel(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    removePromotionsFromChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemovePromotionsFromChannelArgs,
    ): Promise<Promotion[]> {
        return this.promotionService.removePromotionsFromChannel(ctx, args.input);
    }

    /**
     * Encodes any entity IDs used in the filter arguments.
     */
    private encodeConditionsAndActions = <
        T extends ErrorResultUnion<CreatePromotionResult, Promotion> | undefined,
    >(
        maybePromotion: T,
    ): T => {
        if (maybePromotion instanceof Promotion) {
            this.configurableOperationCodec.encodeConfigurableOperationIds(
                PromotionOrderAction,
                maybePromotion.actions,
            );
            this.configurableOperationCodec.encodeConfigurableOperationIds(
                PromotionCondition,
                maybePromotion.conditions,
            );
        }
        return maybePromotion;
    };
}
