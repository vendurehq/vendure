"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const permissions_1 = require("./permissions");
const merchant_admin_service_1 = require("./merchant-admin.service");
/** JSON 字符串入参解析：语法错误直接以 UserInputError 反馈给后台，避免落库脏数据 */
function parseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch (_a) {
        throw new core_1.UserInputError('配置格式不合法（JSON 解析失败）');
    }
}
/** 逐条解析 JSON 字符串数组（空元素跳过） */
function parseJsonList(raw) {
    return (raw !== null && raw !== void 0 ? raw : []).filter(s => String(s !== null && s !== void 0 ? s : '').trim() !== '').map(s => parseJson(String(s)));
}
let MerchantAdminResolver = class MerchantAdminResolver {
    constructor(merchant) {
        this.merchant = merchant;
    }
    /** 商家接单工作台看板：本渠道待接单/备餐中/待取货/配送中 + 今日完成 */
    async campusMerchantBoard(ctx) {
        return this.merchant.board(ctx);
    }
    /** 商家自助经营：门店资料（营业时间/公告/电话/营业状态） */
    async campusMerchantStoreProfile(ctx) {
        return this.merchant.storeProfile(ctx);
    }
    /** 今日/区间已完成订单明细（§75 对账）：送达口径与工作台「今日完成」一致 */
    async campusMerchantCompletedOrders(ctx, from, to, take, skip) {
        return this.merchant.completedOrders(ctx, { from, to, take, skip });
    }
    /** 退款记录台账（§77）：区间内本店退款单，含失败单留痕与汇总 */
    async campusMerchantRefunds(ctx, from, to, take, skip) {
        return this.merchant.refunds(ctx, { from, to, take, skip });
    }
    /** 商家自助修改门店资料：只改本渠道，营业时间写入 Channel 自定义字段 */
    async campusMerchantUpdateStore(ctx, businessHours, storeNotice, storePhone) {
        return this.merchant.updateStore(ctx, { businessHours, storeNotice, storePhone });
    }
    /** 信任文案（§113）：评价页信任签名卡三行开关 + 自定义文案，文案留空=回落 C 端默认 */
    async campusMerchantUpdateTrustCopy(ctx, qualityEnabled, qualityText, serviceEnabled, serviceText, timeEnabled, timeText) {
        return this.merchant.updateTrustCopy(ctx, {
            qualityEnabled, qualityText, serviceEnabled, serviceText, timeEnabled, timeText,
        });
    }
    /** 每日日报推送设置（§86）：营业结束后把昨日日报推到店铺群；time 为 HH:MM，空=21:30 */
    async campusMerchantUpdateDailyPush(ctx, enabled, time) {
        return this.merchant.updateDailyPush(ctx, !!enabled, time);
    }
    /** 售后月度摘要推送设置（§95）：每月指定日（1-28）把上月售后汇总推到店铺群 */
    async campusMerchantUpdateAfterSalesMonthlyPush(ctx, enabled, day, time) {
        return this.merchant.updateAfterSalesMonthlyPush(ctx, !!enabled, day, time);
    }
    /** 售后自动化设置（§96）：自动分配 + 异常预警；仅传需要修改的项，阈值 0=关闭该项 */
    async campusMerchantUpdateAfterSalesAutomation(ctx, autoAssignEnabled, autoAssignMax, alertEnabled, alertRefundRate, alertOverdueCount) {
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
    async campusMerchantSetClosureDates(ctx, dates) {
        const parsed = dates ? parseJson(String(dates)) : [];
        if (!Array.isArray(parsed))
            throw new core_1.UserInputError('休业日历必须是日期数组');
        return this.merchant.updateClosureDates(ctx, parsed);
    }
    /** 经营数据：今日/近 7 日单量、营业额、客单价、取消退款 */
    async campusMerchantRevenue(ctx) {
        return this.merchant.revenue(ctx);
    }
    /** 自定义区间逐日经营数据（§89 导出）：from/to 为 YYYY-MM-DD，含起止两日，最多 366 天 */
    async campusMerchantRevenueRange(ctx, from, to) {
        return this.merchant.revenueRange(ctx, from, to);
    }
    async campusMerchantAcceptOrder(ctx, orderId) {
        return this.merchant.acceptOrder(ctx, orderId);
    }
    /** 商家侧顾客联系方式（号码保护）：开启后仅返回脱敏/虚拟号 */
    async campusMerchantCustomerContact(ctx, orderId) {
        return this.merchant.customerContact(ctx, orderId);
    }
    async campusMerchantCookingDone(ctx, orderId) {
        return this.merchant.cookingDone(ctx, orderId);
    }
    /** 工作台批量接单（§73）：多选订单一次接单，逐单走既有状态机，失败单跳过并回报 */
    async campusMerchantBatchAcceptOrders(ctx, orderIds) {
        return this.merchant.batchAcceptOrders(ctx, orderIds);
    }
    /** 工作台批量出餐（§73）：多选备餐中订单一次出餐，失败单跳过并回报 */
    async campusMerchantBatchCookingDoneOrders(ctx, orderIds) {
        return this.merchant.batchCookingDone(ctx, orderIds);
    }
    /** 商家拒单/缺货：全额退款并取消订单（接单前或备餐中可用） */
    async campusMerchantRejectOrder(ctx, orderId, reason) {
        return this.merchant.rejectOrder(ctx, orderId, reason);
    }
    /** 商家发起退款（§76）：已送达订单整单/部分退款，金额为分；返回本次退款与剩余可退 */
    async campusMerchantRefundOrder(ctx, orderId, amount, reason) {
        return this.merchant.merchantRefund(ctx, orderId, amount, reason);
    }
    /** 营业中开关（本渠道 paused） */
    async campusMerchantSetPaused(ctx, paused) {
        return this.merchant.setPaused(ctx, paused);
    }
    /** 小票打印回执：打印成功后回写 waimaiPrintedAt（防重打 + 补打依据） */
    async campusMerchantMarkPrinted(ctx, orderId) {
        return this.merchant.markPrinted(ctx, orderId);
    }
    /** 顾客催单「已知晓」（§78）：商家确认后工作台/出餐屏解除催单提醒 */
    async campusMerchantAckUrge(ctx, orderId) {
        return this.merchant.ackUrge(ctx, orderId);
    }
    /** KDS 出餐屏（P1-4）：待接单/备餐中队列，按等待时长分级 */
    async campusMerchantKitchenQueue(ctx) {
        return this.merchant.kitchenQueue(ctx);
    }
    /** 备餐汇总（§79）：今日商品份数聚合，后厨按份备料/核对出餐 */
    async campusMerchantPrepSummary(ctx) {
        return this.merchant.prepSummary(ctx);
    }
    /** 营业日报（§80）：单日 KPI + 时段分布 + 商品 Top5 + 对比昨日/近 7 日均值 */
    async campusMerchantDailyReport(ctx, date) {
        return this.merchant.dailyReport(ctx, date);
    }
    /** 售后申请清单（§81）：本店渠道订单的售后单；state 为空=全部，Pending=待处理 */
    async campusMerchantAfterSales(ctx, state, type, orderCode, keyword, tag, assignee, messageKeyword, attention, minAmount, maxAmount, risk, from, to, skip, take) {
        return this.merchant.afterSalesList(ctx, state, { type, orderCode, keyword, tag, assignee, messageKeyword, attention, minAmount, maxAmount, risk, from, to, skip, take });
    }
    /** 售后详情（§81）：协商留言 + 状态时间线 + 退款失败留痕 */
    async campusMerchantAfterSalesDetail(ctx, id) {
        return this.merchant.afterSalesDetail(ctx, id);
    }
    /** 售后处理统计（§81）：待处理/超时/今日处理量/今日退款额 */
    async campusMerchantAfterSalesStats(ctx) {
        return this.merchant.afterSalesStats(ctx);
    }
    /** 售后报表（§83）：区间内量/退款/超时与逐日趋势（校园日 UTC+8） */
    async campusMerchantAfterSalesReport(ctx, from, to) {
        return this.merchant.afterSalesReport(ctx, from, to);
    }
    /** 商品维度售后统计（§92）：Top 商品售后单量/退款额/售后率 */
    async campusMerchantAfterSalesProductReport(ctx, from, to, limit) {
        return this.merchant.afterSalesProductReport(ctx, from, to, limit);
    }
    /** 售后原因分布（§93）：区间内按原因聚合单量/退款/占比与环比 */
    async campusMerchantAfterSalesReasonReport(ctx, from, to, limit) {
        return this.merchant.afterSalesReasonReport(ctx, from, to, limit);
    }
    /** 顾客售后档案（§93）：本店维度历史售后、退款与拉黑状态 */
    async campusMerchantAfterSalesCustomerProfile(ctx, customerId) {
        return this.merchant.afterSalesCustomerProfile(ctx, customerId);
    }
    /** 售后处理凭证（§93）：门店留存/交接用纯文本凭条 */
    async campusMerchantAfterSalesPrintSlip(ctx, id) {
        return this.merchant.afterSalesPrintSlip(ctx, id);
    }
    /** 批量打印售后凭证（§94）：多选一次生成多张凭条，上限 50 */
    async campusMerchantAfterSalesPrintSlips(ctx, ids) {
        return this.merchant.afterSalesPrintSlips(ctx, ids);
    }
    /** 线下退款登记（§94）：现金/转账等线下退款后登记，直接置为已退款 */
    async campusMerchantAfterSalesOfflineRefund(ctx, id, amount, method, note) {
        return this.merchant.afterSalesOfflineRefund(ctx, id, amount, method, note);
    }
    /** 标记售后风险（§94）：争议/异常单 */
    async campusMerchantAfterSalesRiskFlag(ctx, id, reason) {
        return this.merchant.afterSalesRiskFlag(ctx, id, reason);
    }
    /** 解除售后风险标记（§94） */
    async campusMerchantAfterSalesRiskClear(ctx, id) {
        return this.merchant.afterSalesRiskClear(ctx, id);
    }
    /** 新增顾客回访记录（§94）：电话/线上沟通留痕，可预约下次跟进 */
    async campusMerchantAfterSalesAddFollowUp(ctx, id, method, result, note, nextAt) {
        return this.merchant.afterSalesAddFollowUp(ctx, id, method, result, note, nextAt);
    }
    /** 暂停售后 SLA 计时（§95/§96）：等待顾客补充资料/回寄期间不计超时/临期，原因必填 */
    async campusMerchantAfterSalesPauseSla(ctx, id, reason) {
        return this.merchant.afterSalesPauseSla(ctx, id, reason);
    }
    /** 恢复售后 SLA 计时（§95）：暂停时长累计后顺延截止时间 */
    async campusMerchantAfterSalesResumeSla(ctx, id) {
        return this.merchant.afterSalesResumeSla(ctx, id);
    }
    /** 批量关闭售后单（§95）：单批上限 50，逐单返回结果 */
    async campusMerchantAfterSalesBatchClose(ctx, ids, reason) {
        return this.merchant.afterSalesBatchClose(ctx, ids, reason);
    }
    /** 升级平台仲裁（§96）：商家无法自行处理时转平台客服，priority=normal/urgent */
    async campusMerchantAfterSalesEscalate(ctx, id, reason, priority) {
        return this.merchant.afterSalesEscalate(ctx, id, reason, priority);
    }
    /** 关闭平台仲裁工单（§96）：填写处理结论，置为 Resolved */
    async campusMerchantAfterSalesEscalationResolve(ctx, id, resolution) {
        return this.merchant.afterSalesEscalationResolve(ctx, id, resolution);
    }
    /** 售后寄回地址（§83）：本店渠道配置 */
    async campusMerchantAfterSalesReturnAddress(ctx) {
        return this.merchant.afterSalesReturnAddress(ctx);
    }
    /** 售后规则（§84）：处理时限/超时自动同意/退款自动重试 */
    async campusMerchantAfterSalesRules(ctx) {
        return this.merchant.afterSalesRules(ctx);
    }
    /** 大额退款复核队列（§99）：默认待复核，可按状态筛选 */
    async campusMerchantAfterSalesRefundReviews(ctx, status) {
        return this.merchant.afterSalesRefundReviews(ctx, status);
    }
    /** 智能话术推荐（§99）：按售后原因/类型匹配本店快捷回复模板 */
    async campusMerchantAfterSalesSuggestedReplies(ctx, id) {
        return this.merchant.afterSalesSuggestedReplies(ctx, id);
    }
    /** 退款流水（§84）：按退款时间倒序分页 */
    async campusMerchantAfterSalesRefunds(ctx, from, to, skip, take) {
        return this.merchant.afterSalesRefunds(ctx, { from, to, skip, take });
    }
    /** 售后自动化任务（§85）：本店超时/自动同意/退款重试任务 */
    async campusMerchantAfterSalesTasks(ctx, status, skip, take) {
        return this.merchant.afterSalesTasks(ctx, { status, skip, take });
    }
    /** 导出 CSV（§85、§97）：kind=requests|refunds|escalations，可选按状态/类型/关键词/处理人筛选，前端保存为文件 */
    async campusMerchantAfterSalesExport(ctx, from, to, kind, state, type, keyword, assigneeUserId) {
        return this.merchant.afterSalesExport(ctx, from, to, kind, { state, type, keyword, assigneeUserId });
    }
    /** 高频售后顾客 Top N（§85） */
    async campusMerchantAfterSalesTopCustomers(ctx, from, to, limit) {
        return this.merchant.afterSalesTopCustomers(ctx, from, to, limit);
    }
    /** 售后内部备注（§86）：仅本店可见 */
    async campusMerchantAfterSalesNotes(ctx, id) {
        return this.merchant.afterSalesNotes(ctx, id);
    }
    /** 快捷回复模板（§87、§97）：本店渠道，可按分类与关键词检索 */
    async campusMerchantAfterSalesReplyTemplates(ctx, category, keyword) {
        return this.merchant.afterSalesReplyTemplates(ctx, { category, keyword });
    }
    /** 商品维度售后分析（§98）：区间内按商品聚合售后率与退款额 */
    async campusMerchantAfterSalesProductAnalysis(ctx, from, to) {
        return this.merchant.afterSalesProductAnalysis(ctx, from, to);
    }
    /** 退货物流轨迹（§98）：运单信息 + 系统/商家节点合并时间线 */
    async campusMerchantAfterSalesReturnLogistics(ctx, id) {
        return this.merchant.afterSalesReturnLogistics(ctx, id);
    }
    /** 售后自动分流规则（§98）：按优先级升序 */
    async campusMerchantAfterSalesAutoRules(ctx) {
        return this.merchant.afterSalesAutoRules(ctx);
    }
    /** 售后工作台摘要（§88） */
    async campusMerchantAfterSalesWorkbench(ctx) {
        return this.merchant.afterSalesWorkbench(ctx);
    }
    /** 售后标签列表（§88） */
    async campusMerchantAfterSalesTags(ctx) {
        return this.merchant.afterSalesTags(ctx);
    }
    /** 处理人候选（§89） */
    async campusMerchantAfterSalesAssignees(ctx) {
        return this.merchant.afterSalesAssignees(ctx);
    }
    /** 员工处理绩效（§89） */
    async campusMerchantAfterSalesStaffStats(ctx, from, to) {
        return this.merchant.afterSalesStaffStats(ctx, from, to);
    }
    /** 本店黑名单列表（§90） */
    async campusMerchantAfterSalesBlacklist(ctx, skip, take) {
        return this.merchant.afterSalesBlacklist(ctx, { skip, take });
    }
    /** 处理人负载（§91） */
    async campusMerchantAfterSalesAssigneeLoad(ctx) {
        return this.merchant.afterSalesAssigneeLoad(ctx);
    }
    /** 导出选中售后单 CSV（§91） */
    async campusMerchantAfterSalesExportByIds(ctx, ids, kind) {
        return this.merchant.afterSalesExportSelection(ctx, ids, kind);
    }
    /** 同意售后（§81）：仅退款单直接退款到账（链式 Received → Refunded）；顾客申诉单同样适用 */
    async campusMerchantAfterSalesApprove(ctx, id) {
        return this.merchant.afterSalesApprove(ctx, id);
    }
    /** 驳回售后（§81）：reason 必填，顾客在 C 端可见并可在售后详情里申诉 */
    async campusMerchantAfterSalesReject(ctx, id, reason) {
        return this.merchant.afterSalesReject(ctx, id, reason);
    }
    /** 商家协商留言（§81）：与顾客 C 端售后详情双向互通，Closed 后禁言 */
    async campusMerchantAfterSalesReply(ctx, id, content, images) {
        return this.merchant.afterSalesReply(ctx, id, content, images);
    }
    /** 商家确认收到退货（§82）：Returning → Received，可传实收数量与收货备注 */
    async campusMerchantAfterSalesConfirmReturn(ctx, id, receivedQuantity, note) {
        return this.merchant.afterSalesConfirmReturn(ctx, id, receivedQuantity, note);
    }
    /** 售后退款失败重试（§82）：仅 RefundFailed，30 秒内同单一次 */
    async campusMerchantAfterSalesRetryRefund(ctx, id) {
        return this.merchant.afterSalesRetryRefund(ctx, id);
    }
    /** 换货发货（§83）：Received → ExchangeShipped，仅换货单 */
    async campusMerchantAfterSalesExchangeShip(ctx, id, trackingNo, carrier) {
        return this.merchant.afterSalesExchangeShip(ctx, id, trackingNo, carrier);
    }
    /** 批量同意（§83）：单次最多 50 条，逐单返回结果 */
    async campusMerchantAfterSalesBatchApprove(ctx, ids) {
        return this.merchant.afterSalesBatchApprove(ctx, ids);
    }
    /** 批量驳回（§83）：整批共用一个原因，单次最多 50 条 */
    async campusMerchantAfterSalesBatchReject(ctx, ids, reason) {
        return this.merchant.afterSalesBatchReject(ctx, ids, reason);
    }
    /** 保存售后寄回地址（§83） */
    async campusMerchantUpdateAfterSalesReturnAddress(ctx, address) {
        return this.merchant.updateAfterSalesReturnAddress(ctx, address);
    }
    /** 保存售后规则（§84）：只写传入项，保留其它渠道字段 */
    async campusMerchantUpdateAfterSalesRules(ctx, timeoutHours, autoApproveHours, refundAutoRetry, firstResponseTargetHours, resolveTargetHours, dueSoonHours, refundReviewThreshold) {
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
    async campusMerchantAfterSalesTransfer(ctx, id, userId, reason) {
        return this.merchant.afterSalesTransfer(ctx, id, userId, reason);
    }
    /** 大额退款复核（§99）：申请人以外的管理员确认同意或驳回 */
    async campusMerchantAfterSalesResolveRefundReview(ctx, id, approve, note) {
        return this.merchant.afterSalesResolveRefundReview(ctx, id, approve, note);
    }
    /** 商家关闭待处理售后（§84）：Pending → Closed，原因必填并回显顾客 */
    async campusMerchantAfterSalesClose(ctx, id, reason) {
        return this.merchant.afterSalesClose(ctx, id, reason);
    }
    /** 商家催办顾客（§84）：60 秒内同单一次 */
    async campusMerchantAfterSalesRemind(ctx, id, note) {
        return this.merchant.afterSalesRemind(ctx, id, note);
    }
    /** 立即执行售后自动化任务（§85） */
    async campusMerchantAfterSalesRunTask(ctx, id) {
        return this.merchant.afterSalesRunTask(ctx, id);
    }
    /** 一键拉黑高频售后顾客（§85） */
    async campusMerchantBlacklistAfterSalesCustomer(ctx, customerId, reason) {
        return this.merchant.blacklistAfterSalesCustomer(ctx, customerId, reason);
    }
    /** 新增售后内部备注（§86）：顾客不可见 */
    async campusMerchantAfterSalesAddNote(ctx, id, content) {
        return this.merchant.addAfterSalesNote(ctx, id, content);
    }
    /** 删除售后内部备注（§86） */
    async campusMerchantAfterSalesDeleteNote(ctx, id, noteId) {
        return this.merchant.deleteAfterSalesNote(ctx, id, noteId);
    }
    /** 批量催办顾客（§86）：单次最多 20 条 */
    async campusMerchantAfterSalesBatchRemind(ctx, ids, note) {
        return this.merchant.afterSalesBatchRemind(ctx, ids, note);
    }
    /** 批量内部备注（§92）：上限 50 单，逐单结果 */
    async campusMerchantAfterSalesBatchNote(ctx, ids, content) {
        return this.merchant.afterSalesBatchNote(ctx, ids, content);
    }
    /** 保存快捷回复模板（§87、§97）：id 为空=新增，可设分类/关键词/排序 */
    async campusMerchantSaveAfterSalesReplyTemplate(ctx, id, content, category, keywords, sortOrder) {
        return this.merchant.saveAfterSalesReplyTemplate(ctx, id, content, category, keywords, sortOrder);
    }
    /** 删除快捷回复模板（§87） */
    async campusMerchantDeleteAfterSalesReplyTemplate(ctx, id) {
        return this.merchant.deleteAfterSalesReplyTemplate(ctx, id);
    }
    /** 登记退货物流节点（§98）：status=picked_up/in_transit/delivered/exception */
    async campusMerchantAfterSalesRecordReturnLogistics(ctx, id, status, description) {
        return this.merchant.afterSalesRecordReturnLogistics(ctx, id, status, description);
    }
    /** 售后操作审计检索（§100）：按时间/动作/处理人筛选，带订单号 */
    async campusMerchantAfterSalesAuditLogs(ctx, from, to, action, actorUserId, take, skip) {
        return this.merchant.afterSalesAuditLogs(ctx, { from, to, action, actorUserId, take, skip });
    }
    /** 售后操作审计导出（§100）：CSV，按同一筛选条件 */
    async campusMerchantAfterSalesAuditExport(ctx, from, to, action, actorUserId) {
        return this.merchant.afterSalesAuditExport(ctx, { from, to, action, actorUserId });
    }
    /** 售后值班表（§100）：本店全部排班 */
    async campusMerchantAfterSalesDutyRoster(ctx) {
        return this.merchant.afterSalesDutyRoster(ctx);
    }
    /** 整体替换售后值班表（§100）：entries 为 JSON 字符串 [{weekday,startMin,endMin,userId}] */
    async campusMerchantSetAfterSalesDutyRoster(ctx, entries) {
        return this.merchant.setAfterSalesDutyRoster(ctx, parseJson(entries));
    }
    /** 补偿挽留方案列表（§100） */
    async campusMerchantAfterSalesCompensationPlans(ctx) {
        return this.merchant.afterSalesCompensationPlans(ctx);
    }
    /** 保存补偿方案（§100）：id 为空=新增；refundAmount 单位分 */
    async campusMerchantSaveAfterSalesCompensationPlan(ctx, id, name, refundAmount, couponTemplateId, note, enabled) {
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
    async campusMerchantDeleteAfterSalesCompensationPlan(ctx, id) {
        return this.merchant.deleteAfterSalesCompensationPlan(ctx, id);
    }
    /** 一键发放补偿挽留（§100）：部分退款 + 优惠券，随后关闭售后单 */
    async campusMerchantAfterSalesApplyCompensation(ctx, id, planId) {
        return this.merchant.afterSalesApplyCompensation(ctx, id, planId);
    }
    /** 保存售后自动分流规则（§98）：id 为空=新增，action=approve/reject/escalate */
    async campusMerchantSaveAfterSalesAutoRule(ctx, id, name, action, priority, enabled, matchType, matchReason, minAmount, maxAmount, rejectReason) {
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
    async campusMerchantDeleteAfterSalesAutoRule(ctx, id) {
        return this.merchant.deleteAfterSalesAutoRule(ctx, id);
    }
    /** 手动排程退款重试（§87）：仅 RefundFailed */
    async campusMerchantAfterSalesScheduleRefundRetry(ctx, id) {
        return this.merchant.afterSalesScheduleRefundRetry(ctx, id);
    }
    /** 保存售后标签（§88）：id 为空=新增 */
    async campusMerchantSaveAfterSalesTag(ctx, id, name) {
        return this.merchant.saveAfterSalesTag(ctx, id, name);
    }
    /** 删除售后标签（§88） */
    async campusMerchantDeleteAfterSalesTag(ctx, id) {
        return this.merchant.deleteAfterSalesTag(ctx, id);
    }
    /** 设置售后单标签（§88）：整体替换 */
    async campusMerchantSetAfterSalesTags(ctx, id, tagIds) {
        return this.merchant.setAfterSalesTags(ctx, id, tagIds);
    }
    /** 指派处理人（§89）：userId 为空=取消指派 */
    async campusMerchantAfterSalesAssign(ctx, id, userId) {
        return this.merchant.afterSalesAssign(ctx, id, userId);
    }
    /** 批量打标签（§89） */
    async campusMerchantAfterSalesBatchTag(ctx, ids, tagIds) {
        return this.merchant.afterSalesBatchTag(ctx, ids, tagIds);
    }
    /** 解除本店顾客拉黑（§89） */
    async campusMerchantUnblacklistAfterSalesCustomer(ctx, customerId) {
        return this.merchant.unblacklistAfterSalesCustomer(ctx, customerId);
    }
    /** 批量指派处理人（§90）：userId 为空=批量取消 */
    async campusMerchantAfterSalesBatchAssign(ctx, ids, userId) {
        return this.merchant.afterSalesBatchAssign(ctx, ids, userId);
    }
    /** 云打印：后端签名直连服务商，成功后回写小票打印时间 */
    async campusMerchantCloudPrint(ctx, orderId) {
        return this.merchant.cloudPrint(ctx, orderId);
    }
    /** 云打印连通性测试（不占用订单） */
    async campusMerchantCloudPrintTest(ctx) {
        return this.merchant.cloudPrintTest(ctx);
    }
    /** 最近云打印任务（后台排障：失败原因/耗时） */
    async campusMerchantPrintJobs(ctx, limit) {
        return this.merchant.printJobs(ctx, limit);
    }
    /** 一键沽清：本店商品列表（含售罄标记） */
    async campusMerchantProducts(ctx, search, skip, take) {
        return this.merchant.products(ctx, search, skip, take);
    }
    /** 沽清 / 取消沽清（售罄仍展示、不可加购） */
    async campusMerchantSetProductSoldOut(ctx, productId, soldOut) {
        return this.merchant.setProductSoldOut(ctx, productId, soldOut);
    }
    /** 全店批量沽清 / 批量恢复（打烊场景一步到位） */
    async campusMerchantSetAllProductsSoldOut(ctx, soldOut) {
        return this.merchant.setAllProductsSoldOut(ctx, soldOut);
    }
    /** 沽清次日自动恢复：查询开关与待恢复件数 */
    async campusMerchantSoldOutAutoRestore(ctx) {
        return this.merchant.getSoldOutAutoRestore(ctx);
    }
    /** 沽清次日自动恢复：开关 */
    async campusMerchantSetSoldOutAutoRestore(ctx, enabled) {
        return this.merchant.setSoldOutAutoRestore(ctx, enabled);
    }
    /** 商家自动接单设置（§69）：开关 / 延迟秒数 / 每日上限 / 适用范围路线 */
    async campusMerchantAutoAccept(ctx) {
        return this.merchant.autoAcceptSettings(ctx);
    }
    /** 保存自动接单设置；营业中且未暂停才会生效，超每日上限退回人工接单 */
    async campusMerchantUpdateAutoAccept(ctx, enabled, delaySeconds, dailyLimit, routes) {
        return this.merchant.updateAutoAccept(ctx, { enabled, delaySeconds, dailyLimit, routes });
    }
    /** 商品级打包费（分/件）：null 清除回落店铺配置 */
    async campusMerchantSetProductPackingFee(ctx, productId, packingFee) {
        return this.merchant.setProductPackingFee(ctx, productId, packingFee !== null && packingFee !== void 0 ? packingFee : null);
    }
    /** 每日限量 / 每人限购（§68）：传 null 或 0 = 不限 */
    async campusMerchantSetProductLimit(ctx, productId, dailyLimit, perUserLimit) {
        return this.merchant.setProductLimit(ctx, productId, dailyLimit !== null && dailyLimit !== void 0 ? dailyLimit : null, perUserLimit !== null && perUserLimit !== void 0 ? perUserLimit : null);
    }
    /** 商品加料组（P1-2）：传空数组清除 */
    async campusMerchantSetProductAddonGroups(ctx, productId, groups) {
        return this.merchant.setProductAddonGroups(ctx, productId, parseJsonList(groups));
    }
    /** 商品套餐内容（P1-2）：传 null 清除 */
    async campusMerchantSetProductCombo(ctx, productId, combo) {
        return this.merchant.setProductCombo(ctx, productId, combo ? parseJson(combo) : null);
    }
    /** 推送外部快递：provider = dada | meituan（由运营中心在派单时选择） */
    async campusMerchantDispatchExternal(ctx, orderId, provider) {
        return this.merchant.dispatchExternal(ctx, orderId, provider);
    }
    /** 取消外部快递（改推另一家前先取消，或运力失败回落） */
    async campusMerchantCancelExternal(ctx, orderId, reason) {
        return this.merchant.cancelExternal(ctx, orderId, reason);
    }
    /** 自营快递接单（R1 商户超时转自营 / R3 自营池）：商户可接，运营调度也可代接 */
    async campusMerchantAcceptOwned(ctx, orderId) {
        return this.merchant.acceptOwned(ctx, orderId);
    }
    /** 自营快递确认取餐（assigned → in_progress，写 pickedUpAt）：商户可确认，运营调度也可代确认 */
    async campusMerchantPickupOwned(ctx, orderId) {
        return this.merchant.pickupOwned(ctx, orderId);
    }
    /** R1：商户送达校园交接点（之后由传信者接力） */
    async campusMerchantMarkHandoverArrived(ctx, orderId) {
        return this.merchant.markHandoverArrived(ctx, orderId);
    }
    /** 自营快递送达：R1/R2 到交接点，R3 到学生（商户可确认，运营调度也可代确认） */
    async campusMerchantMarkOwnedArrived(ctx, orderId) {
        return this.merchant.markOwnedArrived(ctx, orderId);
    }
};
exports.MerchantAdminResolver = MerchantAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantBoard", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantStoreProfile", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'from', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'to', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'take', type: () => Number, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'skip', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantCompletedOrders", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'from', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'to', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'take', type: () => Number, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'skip', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantRefunds", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'businessHours', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'storeNotice', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'storePhone', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUpdateStore", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'qualityEnabled', type: () => Boolean, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'qualityText', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'serviceEnabled', type: () => Boolean, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'serviceText', type: () => String, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'timeEnabled', type: () => Boolean, nullable: true })),
    __param(6, (0, graphql_1.Args)({ name: 'timeText', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUpdateTrustCopy", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'enabled', type: () => Boolean })),
    __param(2, (0, graphql_1.Args)({ name: 'time', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Boolean, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUpdateDailyPush", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'enabled', type: () => Boolean })),
    __param(2, (0, graphql_1.Args)({ name: 'day', type: () => Number, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'time', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Boolean, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUpdateAfterSalesMonthlyPush", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'autoAssignEnabled', type: () => Boolean, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'autoAssignMax', type: () => graphql_1.Int, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'alertEnabled', type: () => Boolean, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'alertRefundRate', type: () => graphql_1.Int, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'alertOverdueCount', type: () => graphql_1.Int, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUpdateAfterSalesAutomation", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'dates', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetClosureDates", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantRevenue", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('from')),
    __param(2, (0, graphql_1.Args)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantRevenueRange", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAcceptOrder", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantCustomerContact", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantCookingDone", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'orderIds', type: () => [String] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantBatchAcceptOrders", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'orderIds', type: () => [String] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantBatchCookingDoneOrders", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantRejectOrder", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('amount')),
    __param(3, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Number, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantRefundOrder", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('paused')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Boolean]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetPaused", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantMarkPrinted", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAckUrge", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantKitchenQueue", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantPrepSummary", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'date', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantDailyReport", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'state', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'type', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'orderCode', type: () => String, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'keyword', type: () => String, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'tag', type: () => String, nullable: true })),
    __param(6, (0, graphql_1.Args)({ name: 'assignee', type: () => String, nullable: true })),
    __param(7, (0, graphql_1.Args)({ name: 'messageKeyword', type: () => String, nullable: true })),
    __param(8, (0, graphql_1.Args)({ name: 'attention', type: () => String, nullable: true })),
    __param(9, (0, graphql_1.Args)({ name: 'minAmount', type: () => graphql_1.Int, nullable: true })),
    __param(10, (0, graphql_1.Args)({ name: 'maxAmount', type: () => graphql_1.Int, nullable: true })),
    __param(11, (0, graphql_1.Args)({ name: 'risk', type: () => String, nullable: true })),
    __param(12, (0, graphql_1.Args)({ name: 'from', type: () => String, nullable: true })),
    __param(13, (0, graphql_1.Args)({ name: 'to', type: () => String, nullable: true })),
    __param(14, (0, graphql_1.Args)({ name: 'skip', type: () => Number, nullable: true })),
    __param(15, (0, graphql_1.Args)({ name: 'take', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSales", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesDetail", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesStats", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('from')),
    __param(2, (0, graphql_1.Args)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesReport", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('from')),
    __param(2, (0, graphql_1.Args)('to')),
    __param(3, (0, graphql_1.Args)({ name: 'limit', type: () => graphql_1.Int, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesProductReport", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('from')),
    __param(2, (0, graphql_1.Args)('to')),
    __param(3, (0, graphql_1.Args)({ name: 'limit', type: () => graphql_1.Int, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesReasonReport", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('customerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesCustomerProfile", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesPrintSlip", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'ids', type: () => [String] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesPrintSlips", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)({ name: 'amount', type: () => graphql_1.Int })),
    __param(3, (0, graphql_1.Args)('method')),
    __param(4, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Number, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesOfflineRefund", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)({ name: 'reason', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRiskFlag", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRiskClear", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('method')),
    __param(3, (0, graphql_1.Args)('result')),
    __param(4, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'nextAt', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesAddFollowUp", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesPauseSla", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesResumeSla", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'ids', type: () => [String] })),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesBatchClose", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('reason')),
    __param(3, (0, graphql_1.Args)({ name: 'priority', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesEscalate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)({ name: 'resolution', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesEscalationResolve", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesReturnAddress", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRules", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'status', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRefundReviews", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesSuggestedReplies", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'from', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'to', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'skip', type: () => Number, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'take', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRefunds", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'status', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'skip', type: () => Number, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'take', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesTasks", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('from')),
    __param(2, (0, graphql_1.Args)('to')),
    __param(3, (0, graphql_1.Args)('kind')),
    __param(4, (0, graphql_1.Args)({ name: 'state', type: () => String, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'type', type: () => String, nullable: true })),
    __param(6, (0, graphql_1.Args)({ name: 'keyword', type: () => String, nullable: true })),
    __param(7, (0, graphql_1.Args)({ name: 'assigneeUserId', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, String, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesExport", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('from')),
    __param(2, (0, graphql_1.Args)('to')),
    __param(3, (0, graphql_1.Args)({ name: 'limit', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesTopCustomers", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesNotes", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'category', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'keyword', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesReplyTemplates", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('from')),
    __param(2, (0, graphql_1.Args)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesProductAnalysis", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesReturnLogistics", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesAutoRules", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesWorkbench", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesTags", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesAssignees", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('from')),
    __param(2, (0, graphql_1.Args)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesStaffStats", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'skip', type: () => Number, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'take', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesBlacklist", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesAssigneeLoad", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'ids', type: () => [String] })),
    __param(2, (0, graphql_1.Args)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesExportByIds", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesApprove", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesReject", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('content')),
    __param(3, (0, graphql_1.Args)({ name: 'images', type: () => [String], nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesReply", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)({ name: 'receivedQuantity', type: () => Number, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesConfirmReturn", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRetryRefund", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('trackingNo')),
    __param(3, (0, graphql_1.Args)({ name: 'carrier', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesExchangeShip", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('ids')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesBatchApprove", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('ids')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesBatchReject", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('address')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUpdateAfterSalesReturnAddress", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'timeoutHours', type: () => Number, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'autoApproveHours', type: () => Number, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'refundAutoRetry', type: () => Number, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'firstResponseTargetHours', type: () => Number, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'resolveTargetHours', type: () => Number, nullable: true })),
    __param(6, (0, graphql_1.Args)({ name: 'dueSoonHours', type: () => Number, nullable: true })),
    __param(7, (0, graphql_1.Args)({ name: 'refundReviewThreshold', type: () => graphql_1.Int, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUpdateAfterSalesRules", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('userId')),
    __param(3, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesTransfer", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('approve')),
    __param(3, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Boolean, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesResolveRefundReview", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesClose", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRemind", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRunTask", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('customerId')),
    __param(2, (0, graphql_1.Args)({ name: 'reason', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantBlacklistAfterSalesCustomer", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('content')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesAddNote", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('noteId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesDeleteNote", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('ids')),
    __param(2, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesBatchRemind", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('ids')),
    __param(2, (0, graphql_1.Args)('content')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesBatchNote", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'id', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)('content')),
    __param(3, (0, graphql_1.Args)({ name: 'category', type: () => String, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'keywords', type: () => String, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'sortOrder', type: () => graphql_1.Int, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSaveAfterSalesReplyTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantDeleteAfterSalesReplyTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('status')),
    __param(3, (0, graphql_1.Args)({ name: 'description', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesRecordReturnLogistics", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'from', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'to', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'action', type: () => String, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'actorUserId', type: () => String, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'take', type: () => graphql_1.Int, nullable: true })),
    __param(6, (0, graphql_1.Args)({ name: 'skip', type: () => graphql_1.Int, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesAuditLogs", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'from', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'to', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'action', type: () => String, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'actorUserId', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesAuditExport", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesDutyRoster", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('entries')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetAfterSalesDutyRoster", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesCompensationPlans", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'id', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)('name')),
    __param(3, (0, graphql_1.Args)('refundAmount')),
    __param(4, (0, graphql_1.Args)({ name: 'couponTemplateId', type: () => String, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __param(6, (0, graphql_1.Args)({ name: 'enabled', type: () => Boolean, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, Number, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSaveAfterSalesCompensationPlan", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantDeleteAfterSalesCompensationPlan", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('planId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesApplyCompensation", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'id', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)('name')),
    __param(3, (0, graphql_1.Args)('action')),
    __param(4, (0, graphql_1.Args)({ name: 'priority', type: () => graphql_1.Int, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'enabled', type: () => Boolean, nullable: true })),
    __param(6, (0, graphql_1.Args)({ name: 'matchType', type: () => String, nullable: true })),
    __param(7, (0, graphql_1.Args)({ name: 'matchReason', type: () => String, nullable: true })),
    __param(8, (0, graphql_1.Args)({ name: 'minAmount', type: () => graphql_1.Int, nullable: true })),
    __param(9, (0, graphql_1.Args)({ name: 'maxAmount', type: () => graphql_1.Int, nullable: true })),
    __param(10, (0, graphql_1.Args)({ name: 'rejectReason', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, String, Object, Object, Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSaveAfterSalesAutoRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantDeleteAfterSalesAutoRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesScheduleRefundRetry", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'id', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSaveAfterSalesTag", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantDeleteAfterSalesTag", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)({ name: 'tagIds', type: () => [String] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Array]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetAfterSalesTags", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)({ name: 'userId', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesAssign", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'ids', type: () => [String] })),
    __param(2, (0, graphql_1.Args)({ name: 'tagIds', type: () => [String] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array, Array]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesBatchTag", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('customerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUnblacklistAfterSalesCustomer", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'ids', type: () => [String] })),
    __param(2, (0, graphql_1.Args)({ name: 'userId', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Array, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAfterSalesBatchAssign", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantCloudPrint", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantCloudPrintTest", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'limit', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Number]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantPrintJobs", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'search', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'skip', type: () => Number, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'take', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, Number, Number]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantProducts", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('productId')),
    __param(2, (0, graphql_1.Args)('soldOut')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Boolean]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetProductSoldOut", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('soldOut')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Boolean]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetAllProductsSoldOut", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSoldOutAutoRestore", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('enabled')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Boolean]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetSoldOutAutoRestore", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAutoAccept", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('enabled')),
    __param(2, (0, graphql_1.Args)({ name: 'delaySeconds', type: () => Number, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'dailyLimit', type: () => Number, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'routes', type: () => [String], nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Boolean, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantUpdateAutoAccept", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('productId')),
    __param(2, (0, graphql_1.Args)({ name: 'packingFee', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetProductPackingFee", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('productId')),
    __param(2, (0, graphql_1.Args)({ name: 'dailyLimit', type: () => Number, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'perUserLimit', type: () => Number, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetProductLimit", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('productId')),
    __param(2, (0, graphql_1.Args)({ name: 'groups', type: () => [String] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Array]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetProductAddonGroups", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('productId')),
    __param(2, (0, graphql_1.Args)({ name: 'combo', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantSetProductCombo", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('provider')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantDispatchExternal", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)({ name: 'reason', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantCancelExternal", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant, permissions_1.CampusPermissions.CampusDispatch),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantAcceptOwned", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant, permissions_1.CampusPermissions.CampusDispatch),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantPickupOwned", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantMarkHandoverArrived", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant, permissions_1.CampusPermissions.CampusDispatch),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MerchantAdminResolver.prototype, "campusMerchantMarkOwnedArrived", null);
exports.MerchantAdminResolver = MerchantAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [merchant_admin_service_1.MerchantAdminService])
], MerchantAdminResolver);
//# sourceMappingURL=merchant-admin.resolver.js.map