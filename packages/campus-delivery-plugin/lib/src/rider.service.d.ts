import { Customer, CustomerService, RequestContext, TransactionalConnection } from '@vendure/core';
import { RiderOpsService } from './rider-ops.service';
import { type RiderCompliancePatch, type RiderComplianceResult } from './rider-compliance';
/** 飞书 open_id 反查骑手的四态结果：
 * - unbound：没有任何 Customer 绑定该 open_id
 * - conflict：多条绑定（历史脏数据），不猜身份
 * - notApproved：已绑定但未过审/已停用
 * - ok：可执行抢单
 */
export type FeishuRiderResolution = {
    kind: 'unbound';
} | {
    kind: 'conflict';
} | {
    kind: 'notApproved';
    customer: Customer;
} | {
    kind: 'ok';
    customer: Customer;
};
export declare class RiderService {
    private connection;
    private customerService;
    private riderOps;
    constructor(connection: TransactionalConnection, customerService: CustomerService, riderOps: RiderOpsService);
    /** 当前登录顾客；未登录或无对应顾客一律 ForbiddenError。 */
    private requireCustomer;
    applyRider(ctx: RequestContext, input: {
        realName: string;
        studentNo: string;
        campus: string;
        idImg?: string;
        healthCertImg?: string;
    }): Promise<{
        status: string;
    }>;
    /** 骑手归属渠守卫：Customer 的渠道是多对多，必须 join customer.channels。
     * 否则 A 店审核员可按 customerId 查看/停用 B 店骑手（含学号、证件照）。 */
    private assertCustomerInChannel;
    setRiderStatus(ctx: RequestContext, customerId: number, status: 'approved' | 'suspended' | 'none'): Promise<{
        status: "approved" | "none" | "suspended";
    }>;
    /** 回收某骑手名下在途任务回大厅（单条条件写，避免逐单先读后写）。
     *  仅活跃流转态 + 仍指派本人 + 未取消的单被重置；已送达/异常终态不受影响。 */
    private reclaimActiveTasks;
    /** 飞书 open_id → 骑手 Customer。区分「未绑定」「绑定冲突」「已绑定但未审核通过」「可用」四态，
     * 便于抢单回执给出可执行的下一步（去绑定 / 找运营 / 等审核），并保留解绑重绑能力。 */
    resolveFeishuRider(openId: string): Promise<FeishuRiderResolution>;
    /** 运营绑定/解绑骑手飞书身份：openId 为空即解绑（可反复重绑，不是一次性绑定）。 */
    setFeishuBinding(ctx: RequestContext, customerId: number, openId?: string | null): Promise<boolean>;
    assertApprovedRider(ctx: RequestContext): Promise<Customer>;
    myRiderProfile(ctx: RequestContext): Promise<{
        customerId: import("@vendure/core").ID;
        riderStatus: any;
        riderRealName: any;
        riderStudentNo: any;
        riderCampus: any;
        riderCredit: any;
        compliance: RiderComplianceResult;
        riderHealthCertExpiry: any;
        riderInsuranceExpiry: any;
    }>;
    /** P2-5 平台审核：登记/更新骑手合规资料（健康证 / 保险 / 背调），返回最新合规判定 */
    updateCompliance(ctx: RequestContext, customerId: number, input: RiderCompliancePatch): Promise<RiderComplianceResult & {
        customerId: number;
    }>;
    /** 骑手上下线开关 + 心跳：大厅轮询页每 15s 调 online=true 即续命 */
    setOnline(ctx: RequestContext, online: boolean): Promise<{
        online: boolean;
    }>;
    /**
     * 按 riderStatus 查询入驻申请列表。
     * customFields 为嵌入式物理列，QueryBuilder 用 embedded 路径
     * customer.customFields.riderStatus（与 delivery-plugin 的 order.customFields.* 写法一致）。
     * F8 分页：skip/take 由前端传参，take 缺省 200 兜底防全量。
     */
    listApplications(ctx: RequestContext, status: string, skip?: number, take?: number): Promise<{
        items: Customer[];
        total: number;
    }>;
}
