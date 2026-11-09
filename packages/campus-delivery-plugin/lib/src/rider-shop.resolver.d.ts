import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { CapacityService } from './capacity.service';
import { CampusConfigService } from './campus-config.service';
import { RiderService } from './rider.service';
import { RiderWalletService } from './rider-wallet.service';
export declare class RiderShopResolver {
    private riderService;
    private configService;
    private capacity;
    private wallet;
    private connection;
    constructor(riderService: RiderService, configService: CampusConfigService, capacity: CapacityService, wallet: RiderWalletService, connection: TransactionalConnection);
    /** 需登录：service 内部校验当前顾客，未登录抛 ForbiddenError。 */
    applyRider(ctx: RequestContext, realName: string, studentNo: string, campus: string, idImg?: string, healthCertImg?: string): Promise<{
        status: string;
    }>;
    myRiderProfile(ctx: RequestContext): Promise<{
        customerId: ID;
        riderStatus: any;
        riderRealName: any;
        riderStudentNo: any;
        riderCampus: any;
        riderCredit: any;
        compliance: import("./rider-compliance").RiderComplianceResult;
        riderHealthCertExpiry: any;
        riderInsuranceExpiry: any;
    }>;
    /** 骑手钱包：可用余额 / 冻结中 / 累计收入 */
    myRiderWallet(ctx: RequestContext): Promise<{
        available: number;
        frozen: number;
        totalEarned: number;
    }>;
    /** 余额流水（含分成入账/充值/消费/提现冻结/退回） */
    riderBalanceHistory(ctx: RequestContext, skip?: number, take?: number): Promise<import("@vendure/recharge-card-plugin").BalanceTransaction[]>;
    /** 本人提现申请记录 */
    riderWithdrawRequests(ctx: RequestContext, skip?: number, take?: number): Promise<import("./rider-withdrawal.entity").RiderWithdrawalRequest[]>;
    /** 提现申请：金额（分）+ 收款渠道 + 账号，提交即冻结 */
    riderWithdraw(ctx: RequestContext, amount: number, channel: string, account: string): Promise<import("./rider-withdrawal.entity").RiderWithdrawalRequest | null>;
    /** 骑手上下线开关（大厅轮询页 15s 轮询续命） */
    campusRiderOnline(ctx: RequestContext, online: boolean): Promise<{
        online: boolean;
    }>;
    /** 骑手心跳（30s 定时调），带骑手资格校验 */
    campusRiderHeartbeat(ctx: RequestContext): Promise<{
        online: boolean;
    }>;
    /** T0 运力预检：C 端下单前提示「运力紧张」（公开只读，无需登录） */
    campusCapacityCheck(ctx: RequestContext): Promise<{
        paused: boolean;
        ridersOnline: number;
    }>;
    campusZones(ctx: RequestContext): Promise<{
        fee: number;
        price: number;
        addFee: number;
        breakdown: import("./dynamic-pricing").PricingBreakdownItem[];
        id: any;
        name: string;
    }[]>;
    campusBuildings(ctx: RequestContext, zoneId?: ID): Promise<any[]>;
}
