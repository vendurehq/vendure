import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext, UserInputError } from '@vendure/core';
import { CampusPermissions } from './permissions';
import { MerchantAdminService } from './merchant-admin.service';

/** JSON 字符串入参解析：语法错误直接以 UserInputError 反馈给后台，避免落库脏数据 */
function parseJson(raw: string): any {
    try {
        return JSON.parse(raw);
    } catch {
        throw new UserInputError('配置格式不合法（JSON 解析失败）');
    }
}

/** 逐条解析 JSON 字符串数组（空元素跳过） */
function parseJsonList(raw: string[]): any[] {
    return (raw ?? []).filter(s => String(s ?? '').trim() !== '').map(s => parseJson(String(s)));
}

@Resolver()
export class MerchantAdminResolver {
    constructor(private merchant: MerchantAdminService) {}

    /** 商家接单工作台看板：本渠道待接单/备餐中/待取货/配送中 + 今日完成 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantBoard(@Ctx() ctx: RequestContext) {
        return this.merchant.board(ctx);
    }

    /** 商家自助经营：门店资料（营业时间/公告/电话/营业状态） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantStoreProfile(@Ctx() ctx: RequestContext) {
        return this.merchant.storeProfile(ctx);
    }

    /** 今日/区间已完成订单明细（§75 对账）：送达口径与工作台「今日完成」一致 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantCompletedOrders(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'from', type: () => String, nullable: true }) from?: string | null,
        @Args({ name: 'to', type: () => String, nullable: true }) to?: string | null,
        @Args({ name: 'take', type: () => Number, nullable: true }) take?: number | null,
        @Args({ name: 'skip', type: () => Number, nullable: true }) skip?: number | null,
    ) {
        return this.merchant.completedOrders(ctx, { from, to, take, skip });
    }

    /** 退款记录台账（§77）：区间内本店退款单，含失败单留痕与汇总 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantRefunds(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'from', type: () => String, nullable: true }) from?: string | null,
        @Args({ name: 'to', type: () => String, nullable: true }) to?: string | null,
        @Args({ name: 'take', type: () => Number, nullable: true }) take?: number | null,
        @Args({ name: 'skip', type: () => Number, nullable: true }) skip?: number | null,
    ) {
        return this.merchant.refunds(ctx, { from, to, take, skip });
    }

    /** 商家自助修改门店资料：只改本渠道，营业时间写入 Channel 自定义字段 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUpdateStore(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'businessHours', type: () => String, nullable: true }) businessHours?: string | null,
        @Args({ name: 'storeNotice', type: () => String, nullable: true }) storeNotice?: string | null,
        @Args({ name: 'storePhone', type: () => String, nullable: true }) storePhone?: string | null,
    ) {
        return this.merchant.updateStore(ctx, { businessHours, storeNotice, storePhone });
    }

    /** 信任文案（§113）：评价页信任签名卡三行开关 + 自定义文案，文案留空=回落 C 端默认 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUpdateTrustCopy(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'qualityEnabled', type: () => Boolean, nullable: true }) qualityEnabled?: boolean | null,
        @Args({ name: 'qualityText', type: () => String, nullable: true }) qualityText?: string | null,
        @Args({ name: 'serviceEnabled', type: () => Boolean, nullable: true }) serviceEnabled?: boolean | null,
        @Args({ name: 'serviceText', type: () => String, nullable: true }) serviceText?: string | null,
        @Args({ name: 'timeEnabled', type: () => Boolean, nullable: true }) timeEnabled?: boolean | null,
        @Args({ name: 'timeText', type: () => String, nullable: true }) timeText?: string | null,
    ) {
        return this.merchant.updateTrustCopy(ctx, {
            qualityEnabled, qualityText, serviceEnabled, serviceText, timeEnabled, timeText,
        });
    }

    /** 每日日报推送设置（§86）：营业结束后把昨日日报推到店铺群；time 为 HH:MM，空=21:30 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUpdateDailyPush(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'enabled', type: () => Boolean }) enabled: boolean,
        @Args({ name: 'time', type: () => String, nullable: true }) time?: string | null,
    ) {
        return this.merchant.updateDailyPush(ctx, !!enabled, time);
    }

    /** 售后月度摘要推送设置（§95）：每月指定日（1-28）把上月售后汇总推到店铺群 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUpdateAfterSalesMonthlyPush(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'enabled', type: () => Boolean }) enabled: boolean,
        @Args({ name: 'day', type: () => Number, nullable: true }) day?: number | null,
        @Args({ name: 'time', type: () => String, nullable: true }) time?: string | null,
    ) {
        return this.merchant.updateAfterSalesMonthlyPush(ctx, !!enabled, day, time);
    }

    /** 售后自动化设置（§96）：自动分配 + 异常预警；仅传需要修改的项，阈值 0=关闭该项 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUpdateAfterSalesAutomation(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'autoAssignEnabled', type: () => Boolean, nullable: true }) autoAssignEnabled?: boolean | null,
        @Args({ name: 'autoAssignMax', type: () => Int, nullable: true }) autoAssignMax?: number | null,
        @Args({ name: 'alertEnabled', type: () => Boolean, nullable: true }) alertEnabled?: boolean | null,
        @Args({ name: 'alertRefundRate', type: () => Int, nullable: true }) alertRefundRate?: number | null,
        @Args({ name: 'alertOverdueCount', type: () => Int, nullable: true }) alertOverdueCount?: number | null,
    ) {
        return this.merchant.updateAfterSalesAutomation(ctx, {
            autoAssignEnabled,
            autoAssignMax,
            alertEnabled,
            alertRefundRate,
            alertOverdueCount,
        });
    }

    /** 营业日历（§70）：整体替换休业日期列表，当天 C 端「今日休业」并拦截下单。
     * dates 入参为 JSON 字符串：[{date:'YYYY-MM-DD', note?}]，空/[]=关闭；非法条目由服务层拒绝。 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetClosureDates(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'dates', type: () => String, nullable: true }) dates?: string | null,
    ) {
        const parsed = dates ? parseJson(String(dates)) : [];
        if (!Array.isArray(parsed)) throw new UserInputError('休业日历必须是日期数组');
        return this.merchant.updateClosureDates(ctx, parsed);
    }

    /** 经营数据：今日/近 7 日单量、营业额、客单价、取消退款 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantRevenue(@Ctx() ctx: RequestContext) {
        return this.merchant.revenue(ctx);
    }

    /** 自定义区间逐日经营数据（§89 导出）：from/to 为 YYYY-MM-DD，含起止两日，最多 366 天 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantRevenueRange(
        @Ctx() ctx: RequestContext,
        @Args('from') from: string,
        @Args('to') to: string,
    ) {
        return this.merchant.revenueRange(ctx, from, to);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAcceptOrder(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.acceptOrder(ctx, orderId);
    }

    /** 商家侧顾客联系方式（号码保护）：开启后仅返回脱敏/虚拟号 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantCustomerContact(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.customerContact(ctx, orderId);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantCookingDone(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.cookingDone(ctx, orderId);
    }

    /** 工作台批量接单（§73）：多选订单一次接单，逐单走既有状态机，失败单跳过并回报 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantBatchAcceptOrders(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'orderIds', type: () => [String] }) orderIds: string[],
    ) {
        return this.merchant.batchAcceptOrders(ctx, orderIds);
    }

    /** 工作台批量出餐（§73）：多选备餐中订单一次出餐，失败单跳过并回报 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantBatchCookingDoneOrders(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'orderIds', type: () => [String] }) orderIds: string[],
    ) {
        return this.merchant.batchCookingDone(ctx, orderIds);
    }

    /** 商家拒单/缺货：全额退款并取消订单（接单前或备餐中可用） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantRejectOrder(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('reason') reason: string,
    ) {
        return this.merchant.rejectOrder(ctx, orderId, reason);
    }

    /** 商家发起退款（§76）：已送达订单整单/部分退款，金额为分；返回本次退款与剩余可退 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantRefundOrder(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('amount') amount: number,
        @Args('reason') reason: string,
    ) {
        return this.merchant.merchantRefund(ctx, orderId, amount, reason);
    }

    /** 营业中开关（本渠道 paused） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetPaused(@Ctx() ctx: RequestContext, @Args('paused') paused: boolean) {
        return this.merchant.setPaused(ctx, paused);
    }

    /** 小票打印回执：打印成功后回写 waimaiPrintedAt（防重打 + 补打依据） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantMarkPrinted(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.markPrinted(ctx, orderId);
    }

    /** 顾客催单「已知晓」（§78）：商家确认后工作台/出餐屏解除催单提醒 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAckUrge(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.ackUrge(ctx, orderId);
    }

    /** KDS 出餐屏（P1-4）：待接单/备餐中队列，按等待时长分级 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantKitchenQueue(@Ctx() ctx: RequestContext) {
        return this.merchant.kitchenQueue(ctx);
    }

    /** 备餐汇总（§79）：今日商品份数聚合，后厨按份备料/核对出餐 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantPrepSummary(@Ctx() ctx: RequestContext) {
        return this.merchant.prepSummary(ctx);
    }

    /** 营业日报（§80）：单日 KPI + 时段分布 + 商品 Top5 + 对比昨日/近 7 日均值 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantDailyReport(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'date', type: () => String, nullable: true }) date?: string | null,
    ) {
        return this.merchant.dailyReport(ctx, date);
    }

    /** 售后申请清单（§81）：本店渠道订单的售后单；state 为空=全部，Pending=待处理 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSales(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'state', type: () => String, nullable: true }) state?: string | null,
        @Args({ name: 'type', type: () => String, nullable: true }) type?: string | null,
        @Args({ name: 'orderCode', type: () => String, nullable: true }) orderCode?: string | null,
        @Args({ name: 'keyword', type: () => String, nullable: true }) keyword?: string | null,
        @Args({ name: 'tag', type: () => String, nullable: true }) tag?: string | null,
        @Args({ name: 'assignee', type: () => String, nullable: true }) assignee?: string | null,
        @Args({ name: 'messageKeyword', type: () => String, nullable: true }) messageKeyword?: string | null,
        @Args({ name: 'attention', type: () => String, nullable: true }) attention?: string | null,
        @Args({ name: 'minAmount', type: () => Int, nullable: true }) minAmount?: number | null,
        @Args({ name: 'maxAmount', type: () => Int, nullable: true }) maxAmount?: number | null,
        @Args({ name: 'risk', type: () => String, nullable: true }) risk?: string | null,
        @Args({ name: 'from', type: () => String, nullable: true }) from?: string | null,
        @Args({ name: 'to', type: () => String, nullable: true }) to?: string | null,
        @Args({ name: 'skip', type: () => Number, nullable: true }) skip?: number | null,
        @Args({ name: 'take', type: () => Number, nullable: true }) take?: number | null,
    ) {
        return this.merchant.afterSalesList(ctx, state, { type, orderCode, keyword, tag, assignee, messageKeyword, attention, minAmount, maxAmount, risk, from, to, skip, take });
    }

    /** 售后详情（§81）：协商留言 + 状态时间线 + 退款失败留痕 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesDetail(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesDetail(ctx, id);
    }

    /** 售后处理统计（§81）：待处理/超时/今日处理量/今日退款额 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesStats(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesStats(ctx);
    }

    /** 售后报表（§83）：区间内量/退款/超时与逐日趋势（校园日 UTC+8） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesReport(
        @Ctx() ctx: RequestContext,
        @Args('from') from: string,
        @Args('to') to: string,
    ) {
        return this.merchant.afterSalesReport(ctx, from, to);
    }

    /** 商品维度售后统计（§92）：Top 商品售后单量/退款额/售后率 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesProductReport(
        @Ctx() ctx: RequestContext,
        @Args('from') from: string,
        @Args('to') to: string,
        @Args({ name: 'limit', type: () => Int, nullable: true }) limit?: number | null,
    ) {
        return this.merchant.afterSalesProductReport(ctx, from, to, limit);
    }

    /** 售后原因分布（§93）：区间内按原因聚合单量/退款/占比与环比 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesReasonReport(
        @Ctx() ctx: RequestContext,
        @Args('from') from: string,
        @Args('to') to: string,
        @Args({ name: 'limit', type: () => Int, nullable: true }) limit?: number | null,
    ) {
        return this.merchant.afterSalesReasonReport(ctx, from, to, limit);
    }

    /** 顾客售后档案（§93）：本店维度历史售后、退款与拉黑状态 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesCustomerProfile(
        @Ctx() ctx: RequestContext,
        @Args('customerId') customerId: ID,
    ) {
        return this.merchant.afterSalesCustomerProfile(ctx, customerId);
    }

    /** 售后处理凭证（§93）：门店留存/交接用纯文本凭条 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesPrintSlip(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ) {
        return this.merchant.afterSalesPrintSlip(ctx, id);
    }

    /** 批量打印售后凭证（§94）：多选一次生成多张凭条，上限 50 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesPrintSlips(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'ids', type: () => [String] }) ids: string[],
    ) {
        return this.merchant.afterSalesPrintSlips(ctx, ids);
    }

    /** 线下退款登记（§94）：现金/转账等线下退款后登记，直接置为已退款 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesOfflineRefund(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args({ name: 'amount', type: () => Int }) amount: number,
        @Args('method') method: string,
        @Args({ name: 'note', type: () => String, nullable: true }) note?: string | null,
    ) {
        return this.merchant.afterSalesOfflineRefund(ctx, id, amount, method, note);
    }

    /** 标记售后风险（§94）：争议/异常单 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRiskFlag(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args({ name: 'reason', type: () => String, nullable: true }) reason?: string | null,
    ) {
        return this.merchant.afterSalesRiskFlag(ctx, id, reason);
    }

    /** 解除售后风险标记（§94） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRiskClear(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ) {
        return this.merchant.afterSalesRiskClear(ctx, id);
    }

    /** 新增顾客回访记录（§94）：电话/线上沟通留痕，可预约下次跟进 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesAddFollowUp(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('method') method: string,
        @Args('result') result: string,
        @Args({ name: 'note', type: () => String, nullable: true }) note?: string | null,
        @Args({ name: 'nextAt', type: () => String, nullable: true }) nextAt?: string | null,
    ) {
        return this.merchant.afterSalesAddFollowUp(ctx, id, method, result, note, nextAt);
    }

    /** 暂停售后 SLA 计时（§95/§96）：等待顾客补充资料/回寄期间不计超时/临期，原因必填 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesPauseSla(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('reason') reason: string,
    ) {
        return this.merchant.afterSalesPauseSla(ctx, id, reason);
    }

    /** 恢复售后 SLA 计时（§95）：暂停时长累计后顺延截止时间 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesResumeSla(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesResumeSla(ctx, id);
    }

    /** 批量关闭售后单（§95）：单批上限 50，逐单返回结果 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesBatchClose(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'ids', type: () => [String] }) ids: ID[],
        @Args('reason') reason: string,
    ) {
        return this.merchant.afterSalesBatchClose(ctx, ids, reason);
    }

    /** 升级平台仲裁（§96）：商家无法自行处理时转平台客服，priority=normal/urgent */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesEscalate(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('reason') reason: string,
        @Args({ name: 'priority', type: () => String, nullable: true }) priority?: string | null,
    ) {
        return this.merchant.afterSalesEscalate(ctx, id, reason, priority);
    }

    /** 关闭平台仲裁工单（§96）：填写处理结论，置为 Resolved */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesEscalationResolve(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args({ name: 'resolution', type: () => String, nullable: true }) resolution?: string | null,
    ) {
        return this.merchant.afterSalesEscalationResolve(ctx, id, resolution);
    }

    /** 售后寄回地址（§83）：本店渠道配置 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesReturnAddress(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesReturnAddress(ctx);
    }

    /** 售后规则（§84）：处理时限/超时自动同意/退款自动重试 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRules(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesRules(ctx);
    }

    /** 大额退款复核队列（§99）：默认待复核，可按状态筛选 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRefundReviews(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'status', type: () => String, nullable: true }) status?: string | null,
    ) {
        return this.merchant.afterSalesRefundReviews(ctx, status);
    }

    /** 智能话术推荐（§99）：按售后原因/类型匹配本店快捷回复模板 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesSuggestedReplies(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesSuggestedReplies(ctx, id);
    }

    /** 退款流水（§84）：按退款时间倒序分页 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRefunds(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'from', type: () => String, nullable: true }) from?: string | null,
        @Args({ name: 'to', type: () => String, nullable: true }) to?: string | null,
        @Args({ name: 'skip', type: () => Number, nullable: true }) skip?: number | null,
        @Args({ name: 'take', type: () => Number, nullable: true }) take?: number | null,
    ) {
        return this.merchant.afterSalesRefunds(ctx, { from, to, skip, take });
    }

    /** 售后自动化任务（§85）：本店超时/自动同意/退款重试任务 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesTasks(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'status', type: () => String, nullable: true }) status?: string | null,
        @Args({ name: 'skip', type: () => Number, nullable: true }) skip?: number | null,
        @Args({ name: 'take', type: () => Number, nullable: true }) take?: number | null,
    ) {
        return this.merchant.afterSalesTasks(ctx, { status, skip, take });
    }

    /** 导出 CSV（§85、§97）：kind=requests|refunds|escalations，可选按状态/类型/关键词/处理人筛选，前端保存为文件 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesExport(
        @Ctx() ctx: RequestContext,
        @Args('from') from: string,
        @Args('to') to: string,
        @Args('kind') kind: string,
        @Args({ name: 'state', type: () => String, nullable: true }) state?: string | null,
        @Args({ name: 'type', type: () => String, nullable: true }) type?: string | null,
        @Args({ name: 'keyword', type: () => String, nullable: true }) keyword?: string | null,
        @Args({ name: 'assigneeUserId', type: () => String, nullable: true }) assigneeUserId?: string | null,
    ) {
        return this.merchant.afterSalesExport(ctx, from, to, kind, { state, type, keyword, assigneeUserId });
    }

    /** 高频售后顾客 Top N（§85） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesTopCustomers(
        @Ctx() ctx: RequestContext,
        @Args('from') from: string,
        @Args('to') to: string,
        @Args({ name: 'limit', type: () => Number, nullable: true }) limit?: number | null,
    ) {
        return this.merchant.afterSalesTopCustomers(ctx, from, to, limit);
    }

    /** 售后内部备注（§86）：仅本店可见 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesNotes(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesNotes(ctx, id);
    }

    /** 快捷回复模板（§87、§97）：本店渠道，可按分类与关键词检索 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesReplyTemplates(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'category', type: () => String, nullable: true }) category?: string | null,
        @Args({ name: 'keyword', type: () => String, nullable: true }) keyword?: string | null,
    ) {
        return this.merchant.afterSalesReplyTemplates(ctx, { category, keyword });
    }

    /** 商品维度售后分析（§98）：区间内按商品聚合售后率与退款额 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesProductAnalysis(
        @Ctx() ctx: RequestContext,
        @Args('from') from: string,
        @Args('to') to: string,
    ) {
        return this.merchant.afterSalesProductAnalysis(ctx, from, to);
    }

    /** 退货物流轨迹（§98）：运单信息 + 系统/商家节点合并时间线 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesReturnLogistics(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesReturnLogistics(ctx, id);
    }

    /** 售后自动分流规则（§98）：按优先级升序 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesAutoRules(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesAutoRules(ctx);
    }

    /** 售后工作台摘要（§88） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesWorkbench(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesWorkbench(ctx);
    }

    /** 售后标签列表（§88） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesTags(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesTags(ctx);
    }

    /** 处理人候选（§89） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesAssignees(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesAssignees(ctx);
    }

    /** 员工处理绩效（§89） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesStaffStats(
        @Ctx() ctx: RequestContext,
        @Args('from') from: string,
        @Args('to') to: string,
    ) {
        return this.merchant.afterSalesStaffStats(ctx, from, to);
    }

    /** 本店黑名单列表（§90） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesBlacklist(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'skip', type: () => Number, nullable: true }) skip?: number | null,
        @Args({ name: 'take', type: () => Number, nullable: true }) take?: number | null,
    ) {
        return this.merchant.afterSalesBlacklist(ctx, { skip, take });
    }

    /** 处理人负载（§91） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesAssigneeLoad(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesAssigneeLoad(ctx);
    }

    /** 导出选中售后单 CSV（§91） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesExportByIds(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'ids', type: () => [String] }) ids: ID[],
        @Args('kind') kind: string,
    ) {
        return this.merchant.afterSalesExportSelection(ctx, ids, kind);
    }

    /** 同意售后（§81）：仅退款单直接退款到账（链式 Received → Refunded）；顾客申诉单同样适用 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesApprove(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesApprove(ctx, id);
    }

    /** 驳回售后（§81）：reason 必填，顾客在 C 端可见并可在售后详情里申诉 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesReject(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('reason') reason: string,
    ) {
        return this.merchant.afterSalesReject(ctx, id, reason);
    }

    /** 商家协商留言（§81）：与顾客 C 端售后详情双向互通，Closed 后禁言 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesReply(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('content') content: string,
        @Args({ name: 'images', type: () => [String], nullable: true }) images?: string[] | null,
    ) {
        return this.merchant.afterSalesReply(ctx, id, content, images);
    }

    /** 商家确认收到退货（§82）：Returning → Received，可传实收数量与收货备注 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesConfirmReturn(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args({ name: 'receivedQuantity', type: () => Number, nullable: true }) receivedQuantity?: number | null,
        @Args({ name: 'note', type: () => String, nullable: true }) note?: string | null,
    ) {
        return this.merchant.afterSalesConfirmReturn(ctx, id, receivedQuantity, note);
    }

    /** 售后退款失败重试（§82）：仅 RefundFailed，30 秒内同单一次 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRetryRefund(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesRetryRefund(ctx, id);
    }

    /** 换货发货（§83）：Received → ExchangeShipped，仅换货单 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesExchangeShip(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('trackingNo') trackingNo: string,
        @Args({ name: 'carrier', type: () => String, nullable: true }) carrier?: string | null,
    ) {
        return this.merchant.afterSalesExchangeShip(ctx, id, trackingNo, carrier);
    }

    /** 批量同意（§83）：单次最多 50 条，逐单返回结果 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesBatchApprove(@Ctx() ctx: RequestContext, @Args('ids') ids: ID[]) {
        return this.merchant.afterSalesBatchApprove(ctx, ids);
    }

    /** 批量驳回（§83）：整批共用一个原因，单次最多 50 条 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesBatchReject(
        @Ctx() ctx: RequestContext,
        @Args('ids') ids: ID[],
        @Args('reason') reason: string,
    ) {
        return this.merchant.afterSalesBatchReject(ctx, ids, reason);
    }

    /** 保存售后寄回地址（§83） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUpdateAfterSalesReturnAddress(
        @Ctx() ctx: RequestContext,
        @Args('address') address: string,
    ) {
        return this.merchant.updateAfterSalesReturnAddress(ctx, address);
    }

    /** 保存售后规则（§84）：只写传入项，保留其它渠道字段 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUpdateAfterSalesRules(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'timeoutHours', type: () => Number, nullable: true }) timeoutHours?: number | null,
        @Args({ name: 'autoApproveHours', type: () => Number, nullable: true }) autoApproveHours?: number | null,
        @Args({ name: 'refundAutoRetry', type: () => Number, nullable: true }) refundAutoRetry?: number | null,
        @Args({ name: 'firstResponseTargetHours', type: () => Number, nullable: true }) firstResponseTargetHours?: number | null,
        @Args({ name: 'resolveTargetHours', type: () => Number, nullable: true }) resolveTargetHours?: number | null,
        @Args({ name: 'dueSoonHours', type: () => Number, nullable: true }) dueSoonHours?: number | null,
        @Args({ name: 'refundReviewThreshold', type: () => Int, nullable: true }) refundReviewThreshold?: number | null,
    ) {
        return this.merchant.updateAfterSalesRules(ctx, {
            timeoutHours,
            autoApproveHours,
            refundAutoRetry,
            firstResponseTargetHours,
            resolveTargetHours,
            dueSoonHours,
            refundReviewThreshold,
        });
    }

    /** 售后单转交（§99）：转给另一位本店管理员，原因必填并推送店铺群 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesTransfer(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('userId') userId: ID,
        @Args('reason') reason: string,
    ) {
        return this.merchant.afterSalesTransfer(ctx, id, userId, reason);
    }

    /** 大额退款复核（§99）：申请人以外的管理员确认同意或驳回 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesResolveRefundReview(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('approve') approve: boolean,
        @Args({ name: 'note', type: () => String, nullable: true }) note?: string | null,
    ) {
        return this.merchant.afterSalesResolveRefundReview(ctx, id, approve, note);
    }

    /** 商家关闭待处理售后（§84）：Pending → Closed，原因必填并回显顾客 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesClose(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('reason') reason: string,
    ) {
        return this.merchant.afterSalesClose(ctx, id, reason);
    }

    /** 商家催办顾客（§84）：60 秒内同单一次 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRemind(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args({ name: 'note', type: () => String, nullable: true }) note?: string | null,
    ) {
        return this.merchant.afterSalesRemind(ctx, id, note);
    }

    /** 立即执行售后自动化任务（§85） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRunTask(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesRunTask(ctx, id);
    }

    /** 一键拉黑高频售后顾客（§85） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantBlacklistAfterSalesCustomer(
        @Ctx() ctx: RequestContext,
        @Args('customerId') customerId: ID,
        @Args({ name: 'reason', type: () => String, nullable: true }) reason?: string | null,
    ) {
        return this.merchant.blacklistAfterSalesCustomer(ctx, customerId, reason);
    }

    /** 新增售后内部备注（§86）：顾客不可见 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesAddNote(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('content') content: string,
    ) {
        return this.merchant.addAfterSalesNote(ctx, id, content);
    }

    /** 删除售后内部备注（§86） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesDeleteNote(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('noteId') noteId: ID,
    ) {
        return this.merchant.deleteAfterSalesNote(ctx, id, noteId);
    }

    /** 批量催办顾客（§86）：单次最多 20 条 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesBatchRemind(
        @Ctx() ctx: RequestContext,
        @Args('ids') ids: ID[],
        @Args({ name: 'note', type: () => String, nullable: true }) note?: string | null,
    ) {
        return this.merchant.afterSalesBatchRemind(ctx, ids, note);
    }

    /** 批量内部备注（§92）：上限 50 单，逐单结果 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesBatchNote(
        @Ctx() ctx: RequestContext,
        @Args('ids') ids: ID[],
        @Args('content') content: string,
    ) {
        return this.merchant.afterSalesBatchNote(ctx, ids, content);
    }

    /** 保存快捷回复模板（§87、§97）：id 为空=新增，可设分类/关键词/排序 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSaveAfterSalesReplyTemplate(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'id', type: () => String, nullable: true }) id: ID | null,
        @Args('content') content: string,
        @Args({ name: 'category', type: () => String, nullable: true }) category?: string | null,
        @Args({ name: 'keywords', type: () => String, nullable: true }) keywords?: string | null,
        @Args({ name: 'sortOrder', type: () => Int, nullable: true }) sortOrder?: number | null,
    ) {
        return this.merchant.saveAfterSalesReplyTemplate(ctx, id, content, category, keywords, sortOrder);
    }

    /** 删除快捷回复模板（§87） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantDeleteAfterSalesReplyTemplate(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.deleteAfterSalesReplyTemplate(ctx, id);
    }

    /** 登记退货物流节点（§98）：status=picked_up/in_transit/delivered/exception */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesRecordReturnLogistics(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('status') status: string,
        @Args({ name: 'description', type: () => String, nullable: true }) description?: string | null,
    ) {
        return this.merchant.afterSalesRecordReturnLogistics(ctx, id, status, description);
    }

    /** 售后操作审计检索（§100）：按时间/动作/处理人筛选，带订单号 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesAuditLogs(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'from', type: () => String, nullable: true }) from?: string | null,
        @Args({ name: 'to', type: () => String, nullable: true }) to?: string | null,
        @Args({ name: 'action', type: () => String, nullable: true }) action?: string | null,
        @Args({ name: 'actorUserId', type: () => String, nullable: true }) actorUserId?: ID | null,
        @Args({ name: 'take', type: () => Int, nullable: true }) take?: number | null,
        @Args({ name: 'skip', type: () => Int, nullable: true }) skip?: number | null,
    ) {
        return this.merchant.afterSalesAuditLogs(ctx, { from, to, action, actorUserId, take, skip });
    }

    /** 售后操作审计导出（§100）：CSV，按同一筛选条件 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesAuditExport(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'from', type: () => String, nullable: true }) from?: string | null,
        @Args({ name: 'to', type: () => String, nullable: true }) to?: string | null,
        @Args({ name: 'action', type: () => String, nullable: true }) action?: string | null,
        @Args({ name: 'actorUserId', type: () => String, nullable: true }) actorUserId?: ID | null,
    ) {
        return this.merchant.afterSalesAuditExport(ctx, { from, to, action, actorUserId });
    }

    /** 售后值班表（§100）：本店全部排班 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesDutyRoster(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesDutyRoster(ctx);
    }

    /** 整体替换售后值班表（§100）：entries 为 JSON 字符串 [{weekday,startMin,endMin,userId}] */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetAfterSalesDutyRoster(
        @Ctx() ctx: RequestContext,
        @Args('entries') entries: string,
    ) {
        return this.merchant.setAfterSalesDutyRoster(ctx, parseJson(entries));
    }

    /** 补偿挽留方案列表（§100） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesCompensationPlans(@Ctx() ctx: RequestContext) {
        return this.merchant.afterSalesCompensationPlans(ctx);
    }

    /** 保存补偿方案（§100）：id 为空=新增；refundAmount 单位分 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSaveAfterSalesCompensationPlan(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'id', type: () => String, nullable: true }) id: ID | null,
        @Args('name') name: string,
        @Args('refundAmount') refundAmount: number,
        @Args({ name: 'couponTemplateId', type: () => String, nullable: true }) couponTemplateId?: string | null,
        @Args({ name: 'note', type: () => String, nullable: true }) note?: string | null,
        @Args({ name: 'enabled', type: () => Boolean, nullable: true }) enabled?: boolean | null,
    ) {
        return this.merchant.saveAfterSalesCompensationPlan(ctx, {
            id,
            name,
            refundAmount,
            couponTemplateId,
            note,
            enabled,
        });
    }

    /** 删除补偿方案（§100） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantDeleteAfterSalesCompensationPlan(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.deleteAfterSalesCompensationPlan(ctx, id);
    }

    /** 一键发放补偿挽留（§100）：部分退款 + 优惠券，随后关闭售后单 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesApplyCompensation(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('planId') planId: ID,
    ) {
        return this.merchant.afterSalesApplyCompensation(ctx, id, planId);
    }

    /** 保存售后自动分流规则（§98）：id 为空=新增，action=approve/reject/escalate */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSaveAfterSalesAutoRule(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'id', type: () => String, nullable: true }) id: ID | null,
        @Args('name') name: string,
        @Args('action') action: string,
        @Args({ name: 'priority', type: () => Int, nullable: true }) priority?: number | null,
        @Args({ name: 'enabled', type: () => Boolean, nullable: true }) enabled?: boolean | null,
        @Args({ name: 'matchType', type: () => String, nullable: true }) matchType?: string | null,
        @Args({ name: 'matchReason', type: () => String, nullable: true }) matchReason?: string | null,
        @Args({ name: 'minAmount', type: () => Int, nullable: true }) minAmount?: number | null,
        @Args({ name: 'maxAmount', type: () => Int, nullable: true }) maxAmount?: number | null,
        @Args({ name: 'rejectReason', type: () => String, nullable: true }) rejectReason?: string | null,
    ) {
        return this.merchant.saveAfterSalesAutoRule(ctx, {
            id,
            name,
            action,
            priority,
            enabled,
            matchType,
            matchReason,
            minAmount,
            maxAmount,
            rejectReason,
        });
    }

    /** 删除售后自动分流规则（§98） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantDeleteAfterSalesAutoRule(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.deleteAfterSalesAutoRule(ctx, id);
    }

    /** 手动排程退款重试（§87）：仅 RefundFailed */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesScheduleRefundRetry(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.afterSalesScheduleRefundRetry(ctx, id);
    }

    /** 保存售后标签（§88）：id 为空=新增 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSaveAfterSalesTag(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'id', type: () => String, nullable: true }) id: ID | null,
        @Args('name') name: string,
    ) {
        return this.merchant.saveAfterSalesTag(ctx, id, name);
    }

    /** 删除售后标签（§88） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantDeleteAfterSalesTag(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.merchant.deleteAfterSalesTag(ctx, id);
    }

    /** 设置售后单标签（§88）：整体替换 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetAfterSalesTags(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args({ name: 'tagIds', type: () => [String] }) tagIds: ID[],
    ) {
        return this.merchant.setAfterSalesTags(ctx, id, tagIds);
    }

    /** 指派处理人（§89）：userId 为空=取消指派 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesAssign(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args({ name: 'userId', type: () => String, nullable: true }) userId: ID | null,
    ) {
        return this.merchant.afterSalesAssign(ctx, id, userId);
    }

    /** 批量打标签（§89） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesBatchTag(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'ids', type: () => [String] }) ids: ID[],
        @Args({ name: 'tagIds', type: () => [String] }) tagIds: ID[],
    ) {
        return this.merchant.afterSalesBatchTag(ctx, ids, tagIds);
    }

    /** 解除本店顾客拉黑（§89） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUnblacklistAfterSalesCustomer(@Ctx() ctx: RequestContext, @Args('customerId') customerId: ID) {
        return this.merchant.unblacklistAfterSalesCustomer(ctx, customerId);
    }

    /** 批量指派处理人（§90）：userId 为空=批量取消 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAfterSalesBatchAssign(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'ids', type: () => [String] }) ids: ID[],
        @Args({ name: 'userId', type: () => String, nullable: true }) userId: ID | null,
    ) {
        return this.merchant.afterSalesBatchAssign(ctx, ids, userId);
    }

    /** 云打印：后端签名直连服务商，成功后回写小票打印时间 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantCloudPrint(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.cloudPrint(ctx, orderId);
    }

    /** 云打印连通性测试（不占用订单） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantCloudPrintTest(@Ctx() ctx: RequestContext) {
        return this.merchant.cloudPrintTest(ctx);
    }

    /** 最近云打印任务（后台排障：失败原因/耗时） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantPrintJobs(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'limit', type: () => Number, nullable: true }) limit?: number,
    ) {
        return this.merchant.printJobs(ctx, limit);
    }

    /** 一键沽清：本店商品列表（含售罄标记） */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantProducts(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'search', type: () => String, nullable: true }) search?: string,
        @Args({ name: 'skip', type: () => Number, nullable: true }) skip?: number,
        @Args({ name: 'take', type: () => Number, nullable: true }) take?: number,
    ) {
        return this.merchant.products(ctx, search, skip, take);
    }

    /** 沽清 / 取消沽清（售罄仍展示、不可加购） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetProductSoldOut(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args('soldOut') soldOut: boolean,
    ) {
        return this.merchant.setProductSoldOut(ctx, productId, soldOut);
    }

    /** 全店批量沽清 / 批量恢复（打烊场景一步到位） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetAllProductsSoldOut(
        @Ctx() ctx: RequestContext,
        @Args('soldOut') soldOut: boolean,
    ) {
        return this.merchant.setAllProductsSoldOut(ctx, soldOut);
    }

    /** 沽清次日自动恢复：查询开关与待恢复件数 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSoldOutAutoRestore(@Ctx() ctx: RequestContext) {
        return this.merchant.getSoldOutAutoRestore(ctx);
    }

    /** 沽清次日自动恢复：开关 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetSoldOutAutoRestore(
        @Ctx() ctx: RequestContext,
        @Args('enabled') enabled: boolean,
    ) {
        return this.merchant.setSoldOutAutoRestore(ctx, enabled);
    }

    /** 商家自动接单设置（§69）：开关 / 延迟秒数 / 每日上限 / 适用范围路线 */
    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAutoAccept(@Ctx() ctx: RequestContext) {
        return this.merchant.autoAcceptSettings(ctx);
    }

    /** 保存自动接单设置；营业中且未暂停才会生效，超每日上限退回人工接单 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantUpdateAutoAccept(
        @Ctx() ctx: RequestContext,
        @Args('enabled') enabled: boolean,
        @Args({ name: 'delaySeconds', type: () => Number, nullable: true }) delaySeconds?: number | null,
        @Args({ name: 'dailyLimit', type: () => Number, nullable: true }) dailyLimit?: number | null,
        @Args({ name: 'routes', type: () => [String], nullable: true }) routes?: string[] | null,
    ) {
        return this.merchant.updateAutoAccept(ctx, { enabled, delaySeconds, dailyLimit, routes });
    }

    /** 商品级打包费（分/件）：null 清除回落店铺配置 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetProductPackingFee(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args({ name: 'packingFee', type: () => Number, nullable: true }) packingFee?: number | null,
    ) {
        return this.merchant.setProductPackingFee(ctx, productId, packingFee ?? null);
    }

    /** 每日限量 / 每人限购（§68）：传 null 或 0 = 不限 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetProductLimit(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args({ name: 'dailyLimit', type: () => Number, nullable: true }) dailyLimit?: number | null,
        @Args({ name: 'perUserLimit', type: () => Number, nullable: true }) perUserLimit?: number | null,
    ) {
        return this.merchant.setProductLimit(ctx, productId, dailyLimit ?? null, perUserLimit ?? null);
    }

    /** 商品加料组（P1-2）：传空数组清除 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetProductAddonGroups(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args({ name: 'groups', type: () => [String] }) groups: string[],
    ) {
        return this.merchant.setProductAddonGroups(ctx, productId, parseJsonList(groups));
    }

    /** 商品套餐内容（P1-2）：传 null 清除 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantSetProductCombo(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args({ name: 'combo', type: () => String, nullable: true }) combo?: string | null,
    ) {
        return this.merchant.setProductCombo(ctx, productId, combo ? parseJson(combo) : null);
    }

    /** 推送外部快递：provider = dada | meituan（由运营中心在派单时选择） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantDispatchExternal(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('provider') provider: string,
    ) {
        return this.merchant.dispatchExternal(ctx, orderId, provider as any);
    }

    /** 取消外部快递（改推另一家前先取消，或运力失败回落） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantCancelExternal(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args({ name: 'reason', type: () => String, nullable: true }) reason?: string,
    ) {
        return this.merchant.cancelExternal(ctx, orderId, reason);
    }

    /** 自营快递接单（R1 商户超时转自营 / R3 自营池）：商户可接，运营调度也可代接 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any, CampusPermissions.CampusDispatch as any)
    async campusMerchantAcceptOwned(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.acceptOwned(ctx, orderId);
    }

    /** 自营快递确认取餐（assigned → in_progress，写 pickedUpAt）：商户可确认，运营调度也可代确认 */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any, CampusPermissions.CampusDispatch as any)
    async campusMerchantPickupOwned(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.pickupOwned(ctx, orderId);
    }

    /** R1：商户送达校园交接点（之后由传信者接力） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantMarkHandoverArrived(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.markHandoverArrived(ctx, orderId);
    }

    /** 自营快递送达：R1/R2 到交接点，R3 到学生（商户可确认，运营调度也可代确认） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any, CampusPermissions.CampusDispatch as any)
    async campusMerchantMarkOwnedArrived(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.merchant.markOwnedArrived(ctx, orderId);
    }
}
