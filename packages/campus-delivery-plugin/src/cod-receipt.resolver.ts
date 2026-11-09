import { Args, ID as GqlID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext } from '@vendure/core';
import { CampusPermissions } from './permissions';
import { CodCollectionService, RegisterCodReceiptInput } from './cod-receipt.service';

/** 运营/客服：COD 收款登记、台账查询；作废需主管权限（CampusCodReceiptVoid） */
@Resolver()
export class CodReceiptAdminResolver {
    constructor(private codCollection: CodCollectionService) {}

    @Query()
    @Allow(CampusPermissions.CampusCodReceipt as any)
    async campusCodReceipts(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'orderId', type: () => GqlID, nullable: true }) orderId?: ID,
    ) {
        return this.codCollection.list(ctx, orderId);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusCodReceipt as any)
    async campusRegisterCodReceipt(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('input') input: RegisterCodReceiptInput,
    ) {
        return this.codCollection.register(ctx, orderId, input);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusCodReceiptVoid as any)
    async campusVoidCodReceipt(
        @Ctx() ctx: RequestContext,
        @Args('receiptId') receiptId: ID,
        @Args('reason') reason: string,
    ) {
        return this.codCollection.voidReceipt(ctx, receiptId, reason);
    }
}
