import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import { CapacityService } from './capacity.service';
import { CampusConfigService } from './campus-config.service';
import { RiderService } from './rider.service';
import { RiderWalletService } from './rider-wallet.service';
import { quoteZonesForShop } from './shipping-calculator';

@Resolver()
export class RiderShopResolver {
    constructor(
        private riderService: RiderService,
        private configService: CampusConfigService,
        private capacity: CapacityService,
        private wallet: RiderWalletService,
        private connection: TransactionalConnection,
    ) {}

    /** 需登录：service 内部校验当前顾客，未登录抛 ForbiddenError。 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async applyRider(
        @Ctx() ctx: RequestContext,
        @Args('realName') realName: string,
        @Args('studentNo') studentNo: string,
        @Args('campus') campus: string,
        @Args('idImg', { nullable: true }) idImg?: string,
        @Args('healthCertImg', { nullable: true }) healthCertImg?: string,
    ) {
        return this.riderService.applyRider(ctx, { realName, studentNo, campus, idImg, healthCertImg });
    }

    @Query()
    @Allow(Permission.Authenticated)
    async myRiderProfile(@Ctx() ctx: RequestContext) {
        return this.riderService.myRiderProfile(ctx);
    }

    /** 骑手钱包：可用余额 / 冻结中 / 累计收入 */
    @Query()
    @Allow(Permission.Authenticated)
    async myRiderWallet(@Ctx() ctx: RequestContext) {
        return this.wallet.myRiderWallet(ctx);
    }

    /** 余额流水（含分成入账/充值/消费/提现冻结/退回） */
    @Query()
    @Allow(Permission.Authenticated)
    async riderBalanceHistory(
        @Ctx() ctx: RequestContext,
        @Args('skip', { nullable: true }) skip?: number,
        @Args('take', { nullable: true }) take?: number,
    ) {
        return this.wallet.riderBalanceHistory(ctx, skip, take);
    }

    /** 本人提现申请记录 */
    @Query()
    @Allow(Permission.Authenticated)
    async riderWithdrawRequests(
        @Ctx() ctx: RequestContext,
        @Args('skip', { nullable: true }) skip?: number,
        @Args('take', { nullable: true }) take?: number,
    ) {
        return this.wallet.riderWithdrawRequests(ctx, skip, take);
    }

    /** 提现申请：金额（分）+ 收款渠道 + 账号，提交即冻结 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async riderWithdraw(
        @Ctx() ctx: RequestContext,
        @Args('amount') amount: number,
        @Args('channel') channel: string,
        @Args('account') account: string,
    ) {
        return this.wallet.riderWithdraw(ctx, { amount, channel, account });
    }

    /** 骑手上下线开关（大厅轮询页 15s 轮询续命） */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusRiderOnline(@Ctx() ctx: RequestContext, @Args('online') online: boolean) {
        return this.riderService.setOnline(ctx, online);
    }

    /** 骑手心跳（30s 定时调），带骑手资格校验 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusRiderHeartbeat(@Ctx() ctx: RequestContext) {
        return this.capacity.heartbeat(ctx);
    }

    /** T0 运力预检：C 端下单前提示「运力紧张」（公开只读，无需登录） */
    @Query()
    @Allow(Permission.Public)
    async campusCapacityCheck(@Ctx() ctx: RequestContext) {
        return this.capacity.capacityCheck(ctx);
    }

    // 公开只读：C 端选楼用（分区带实时报价：price/addFee/breakdown，与结算同口径）
    @Query()
    @Allow(Permission.Public)
    async campusZones(@Ctx() ctx: RequestContext) {
        const zones = await this.configService.listZones(ctx);
        return quoteZonesForShop(this.connection, ctx.channelId as ID, zones as any[]);
    }

    @Query()
    @Allow(Permission.Public)
    async campusBuildings(@Ctx() ctx: RequestContext, @Args({ name: 'zoneId', nullable: true }) zoneId?: ID) {
        const buildings = await this.configService.listBuildings(ctx, zoneId != null ? Number(zoneId) : undefined);
        // 楼栋经纬度可能为 NULL（历史数据未标点）：只下发布尔标记，避免 C 端拿到坐标缺失时误以为能送到楼下
        return buildings.map((b: any) => ({ ...b, hasCoords: b.lat != null && b.lng != null }));
    }
}
