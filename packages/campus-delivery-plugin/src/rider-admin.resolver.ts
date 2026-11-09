import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext } from '@vendure/core';
import { RiderService } from './rider.service';
import { CampusPermissions } from './permissions';
import { RiderWalletService } from './rider-wallet.service';
import type { RiderCompliancePatch } from './rider-compliance';

@Resolver()
export class RiderAdminResolver {
    constructor(
        private riderService: RiderService,
        private wallet: RiderWalletService,
    ) {}

    /** 骑手入驻申请列表（F8 分页：返回 { items, total }） */
    @Query()
    @Allow(CampusPermissions.CampusAuditRider as any)
    async riderApplications(
        @Ctx() ctx: RequestContext,
        @Args('status') status: string,
        @Args('skip', { nullable: true }) skip?: number,
        @Args('take', { nullable: true }) take?: number,
    ) {
        return this.riderService.listApplications(ctx, status, skip, take);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusAuditRider as any)
    async campusSetRiderStatus(
        @Ctx() ctx: RequestContext,
        @Args('customerId') customerId: ID,
        @Args('status') status: 'approved' | 'suspended' | 'none',
    ) {
        return this.riderService.setRiderStatus(ctx, Number(customerId), status);
    }

    /** 绑定/解绑骑手飞书身份：openId 为空即解绑；可反复重绑（不是一次性绑定）。
     * open_id 是飞书应用维度标识，必须与 appId 成对绑定；appId 缺省取骑手应用环境变量。
     * 抢单回调按「appId + open_id」反查 Customer，绑定错人时运营先解绑再绑正确账号。 */
    @Mutation()
    @Allow(CampusPermissions.CampusAuditRider as any)
    async campusSetRiderFeishuBinding(
        @Ctx() ctx: RequestContext,
        @Args('customerId') customerId: ID,
        @Args('openId', { nullable: true }) openId?: string,
        @Args('appId', { nullable: true }) appId?: string,
    ) {
        return this.riderService.setFeishuBinding(ctx, Number(customerId), openId, appId);
    }

    /** P2-5 骑手合规：登记/更新健康证、保险、背调，返回最新合规判定 */
    @Mutation()
    @Allow(CampusPermissions.CampusAuditRider as any)
    async campusUpdateRiderCompliance(
        @Ctx() ctx: RequestContext,
        @Args('customerId') customerId: ID,
        @Args('input') input: RiderCompliancePatch,
    ) {
        return this.riderService.updateCompliance(ctx, Number(customerId), input);
    }

    /** 骑手提现申请列表（status=ALL/PENDING/PAID/REJECTED）。
     * 钱包为平台级（余额跨渠道汇总），列表按设计不限定店铺渠道；审核权限 CampusAuditRider。 */
    @Query()
    @Allow(CampusPermissions.CampusAuditRider as any)
    async riderWithdrawals(
        @Ctx() ctx: RequestContext,
        @Args('status', { nullable: true }) status?: string,
        @Args('skip', { nullable: true }) skip?: number,
        @Args('take', { nullable: true }) take?: number,
    ) {
        return this.wallet.adminList(ctx, status, skip, take);
    }

    /** 通过：标记 PAID + 登记打款流水号/凭证（金额已在申请时冻结扣减） */
    @Mutation()
    @Allow(CampusPermissions.CampusAuditRider as any)
    async approveRiderWithdraw(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('remark', { nullable: true }) remark?: string,
        @Args('payoutRef', { nullable: true }) payoutRef?: string,
        @Args('payoutProof', { nullable: true }) payoutProof?: string,
    ) {
        return this.wallet.adminApprove(ctx, id, remark, payoutRef, payoutProof);
    }

    /** 驳回：状态 REJECTED 并退回冻结金额 */
    @Mutation()
    @Allow(CampusPermissions.CampusAuditRider as any)
    async rejectRiderWithdraw(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('remark', { nullable: true }) remark?: string,
    ) {
        return this.wallet.adminReject(ctx, id, remark);
    }

    /** 打款失败回退：PAID → FAILED，退回冻结金额（转账被退回/账号错误时使用） */
    @Mutation()
    @Allow(CampusPermissions.CampusAuditRider as any)
    async campusMarkWithdrawFailed(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('reason') reason: string,
    ) {
        return this.wallet.adminMarkFailed(ctx, id, reason);
    }
}
