import { ID, RequestContext } from '@vendure/core';
import { RiderService } from './rider.service';
import { RiderWalletService } from './rider-wallet.service';
import type { RiderCompliancePatch } from './rider-compliance';
export declare class RiderAdminResolver {
    private riderService;
    private wallet;
    constructor(riderService: RiderService, wallet: RiderWalletService);
    /** 骑手入驻申请列表（F8 分页：返回 { items, total }） */
    riderApplications(ctx: RequestContext, status: string, skip?: number, take?: number): Promise<{
        items: import("@vendure/core").Customer[];
        total: number;
    }>;
    campusSetRiderStatus(ctx: RequestContext, customerId: ID, status: 'approved' | 'suspended' | 'none'): Promise<{
        status: "approved" | "none" | "suspended";
    }>;
    /** 绑定/解绑骑手飞书身份：openId 为空即解绑；可反复重绑（不是一次性绑定）。
     * 抢单回调按 open_id 反查 Customer，绑定错人时运营先解绑再绑正确账号。 */
    campusSetRiderFeishuBinding(ctx: RequestContext, customerId: ID, openId?: string): Promise<boolean>;
    /** P2-5 骑手合规：登记/更新健康证、保险、背调，返回最新合规判定 */
    campusUpdateRiderCompliance(ctx: RequestContext, customerId: ID, input: RiderCompliancePatch): Promise<import("./rider-compliance").RiderComplianceResult & {
        customerId: number;
    }>;
    /** 骑手提现申请列表（status=ALL/PENDING/PAID/REJECTED）。
     * 钱包为平台级（余额跨渠道汇总），列表按设计不限定店铺渠道；审核权限 CampusAuditRider。 */
    riderWithdrawals(ctx: RequestContext, status?: string, skip?: number, take?: number): Promise<import("./rider-withdrawal.entity").RiderWithdrawalRequest[]>;
    /** 通过：标记 PAID + 登记打款流水号/凭证（金额已在申请时冻结扣减） */
    approveRiderWithdraw(ctx: RequestContext, id: ID, remark?: string, payoutRef?: string, payoutProof?: string): Promise<import("./rider-withdrawal.entity").RiderWithdrawalRequest | null>;
    /** 驳回：状态 REJECTED 并退回冻结金额 */
    rejectRiderWithdraw(ctx: RequestContext, id: ID, remark?: string): Promise<import("./rider-withdrawal.entity").RiderWithdrawalRequest | null>;
    /** 打款失败回退：PAID → FAILED，退回冻结金额（转账被退回/账号错误时使用） */
    campusMarkWithdrawFailed(ctx: RequestContext, id: ID, reason: string): Promise<import("./rider-withdrawal.entity").RiderWithdrawalRequest | null>;
}
