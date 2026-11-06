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
exports.AdminPosResolver = void 0;
const common_1 = require("@nestjs/common");
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const constants_1 = require("../constants");
const aggregate_pay_service_1 = require("../services/aggregate-pay.service");
const pos_order_service_1 = require("../services/pos-order.service");
const pos_session_service_1 = require("../services/pos-session.service");
const shift_report_service_1 = require("../services/shift-report.service");
/**
 * POS 收银操作 API：班次生命周期（开班/关班/我的班次）+ 交班对账预览 + 聚合码支付。
 */
let AdminPosResolver = class AdminPosResolver {
    constructor(sessionService, administratorService, orderService, shiftReportService, aggregatePayService) {
        this.sessionService = sessionService;
        this.administratorService = administratorService;
        this.orderService = orderService;
        this.shiftReportService = shiftReportService;
        this.aggregatePayService = aggregatePayService;
    }
    /**
     * 当前管理员的开班班次。
     * ctx.activeUserId 是 User.id，需先转成 Administrator.id 再查。
     */
    async myPosSession(ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            return null;
        return this.sessionService.findMyOpenSession(Number(admin.id));
    }
    async posSession(id) {
        return this.sessionService.findOne(parseInt(id, 10));
    }
    async openSession(input, ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        return this.sessionService.openSession({
            terminalCode: input.terminalCode,
            operatorId: Number(admin.id),
            openingFloat: input.openingFloat,
        });
    }
    async closeSession(input) {
        var _a;
        const session = await this.sessionService.closeSession({
            sessionId: parseInt(input.sessionId, 10),
            closingCash: (_a = input.closingCash) !== null && _a !== void 0 ? _a : 0,
            approverId: input.approverId ? parseInt(input.approverId, 10) : undefined,
        });
        return { session, summary: session.closeSummary };
    }
    async posActiveOrder(ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            return null;
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            return null;
        // ensureActiveOrder 会复用已有 activeOrderId 或创建新 Order（结账后 activeOrderId 已清，会创建新空 Order）
        return this.orderService.ensureActiveOrder(ctx, session);
    }
    async addPosItem(input, ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            throw new core_1.UserInputError('当前无开班班次');
        return this.orderService.addPosItem(ctx, session, {
            productVariantId: input.productVariantId,
            quantity: input.quantity,
            discount: input.discount,
            isGift: input.isGift,
            note: input.note,
            originalPrice: input.originalPrice,
        });
    }
    async updatePosItem(input, ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            throw new core_1.UserInputError('当前无开班班次');
        return this.orderService.updatePosItem(ctx, session, {
            orderLineId: input.orderLineId,
            quantity: input.quantity,
        });
    }
    async checkoutPosOrder(input, ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            throw new core_1.UserInputError('当前无开班班次');
        return this.orderService.checkoutPosOrder(ctx, session, input);
    }
    /**
     * 交班对账单预览：不传 closingCash 则不做现金对账（warnings 为空）。
     * 用于关班前让收银员预览当前班次汇总。
     */
    async shiftReportPreview(sessionId, closingCash) {
        return this.shiftReportService.generateSummary(parseInt(sessionId, 10), closingCash);
    }
    // ===== 聚合码支付 =====
    /**
     * 创建聚合码待支付 Payment。
     * 需当前班次有活跃 Order 且购物车非空。
     */
    async createAggregatePay(input, ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            throw new core_1.UserInputError('当前无开班班次');
        return this.aggregatePayService.createPendingPayment(ctx, session, input);
    }
    /**
     * 确认聚合码支付（客户已扫码付款）。
     * Payment: Created → Authorized
     */
    async confirmAggregatePay(paymentId, ctx) {
        return this.aggregatePayService.confirmPayment(ctx, paymentId);
    }
    /**
     * 结算聚合码支付（关班时批量结算或单笔结算）。
     * Payment: Authorized → Settled
     */
    async settleAggregatePay(paymentId, ctx) {
        return this.aggregatePayService.settlePayment(ctx, paymentId);
    }
    /**
     * 标记聚合码支付失败（超时）。
     * Payment: Created → Cancelled
     */
    async failAggregatePay(paymentId, ctx) {
        return this.aggregatePayService.failPayment(ctx, paymentId);
    }
    /**
     * 批量结算班次内所有 confirmed 状态的聚合码支付。
     * 返回 { settled, failed }，失败逐笔带原因。
     */
    async settleSessionAggregatePays(sessionId, ctx) {
        return this.aggregatePayService.settleSessionPayments(ctx, parseInt(sessionId, 10));
    }
    /**
     * 根据聚合码查询 Payment 状态。
     */
    async aggregatePayByCode(aggregatePayCode) {
        return this.aggregatePayService.findByCode(aggregatePayCode);
    }
    // ===== Phase 5: 退货与挂单 =====
    /**
     * 挂单：把当前活跃 Order 的 orderType 改为 hold，清空 activeOrderId。
     * 无参数（操作当前 session 的 activeOrder）。
     */
    async holdOrder(ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            throw new core_1.UserInputError('当前无开班班次');
        return this.orderService.holdOrder(ctx, session);
    }
    /**
     * 取单：校验目标 Order 为 hold + 归属本终端，加载为当前 activeOrder。
     */
    async resumeOrder(orderId, ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            throw new core_1.UserInputError('当前无开班班次');
        return this.orderService.resumeOrder(ctx, session, orderId);
    }
    /**
     * 挂单列表：当前终端下所有 orderType=hold 的 Draft Order。
     */
    async heldOrders(ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            return [];
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            return [];
        return this.orderService.findHeldOrders(ctx, session);
    }
    /**
     * 按订单号查询原单（退货场景入口）。Admin API 无原生 orderByCode，此处封装。
     */
    async posOrderByCode(code, ctx) {
        return this.orderService.findByCode(ctx, code);
    }
    /**
     * 创建退货单（独立 refund Order，spec 3.10）：
     * 复制原单行为负数量 + createCancellationsForOrderLines 回库 + 现金退款 Payment。
     */
    async createRefundOrder(input, ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session)
            throw new core_1.UserInputError('当前无开班班次');
        return this.orderService.createRefundOrder(ctx, session, {
            originalOrderId: input.originalOrderId,
            refundLines: input.refundLines,
        });
    }
    /**
     * User.id → Administrator。失败返回 undefined（myPosSession 容忍 null，openSession 抛错）。
     */
    async resolveOperator(ctx) {
        const userId = ctx.activeUserId;
        if (!userId)
            return undefined;
        return this.administratorService.findOneByUserId(ctx, userId);
    }
};
exports.AdminPosResolver = AdminPosResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "myPosSession", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Read),
    __param(0, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "posSession", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Create),
    __param(0, (0, graphql_1.Args)('input')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "openSession", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "closeSession", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "posActiveOrder", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('input')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "addPosItem", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('input')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "updatePosItem", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('input')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "checkoutPosOrder", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Read),
    __param(0, (0, graphql_1.Args)('sessionId')),
    __param(1, (0, graphql_1.Args)('closingCash')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "shiftReportPreview", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('input')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "createAggregatePay", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('paymentId')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "confirmAggregatePay", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('paymentId')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "settleAggregatePay", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('paymentId')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "failAggregatePay", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('sessionId')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "settleSessionAggregatePays", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Read),
    __param(0, (0, graphql_1.Args)('aggregatePayCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "aggregatePayByCode", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "holdOrder", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('orderId')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "resumeOrder", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "heldOrders", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Read),
    __param(0, (0, graphql_1.Args)('code')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "posOrderByCode", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, graphql_1.Args)('input')),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminPosResolver.prototype, "createRefundOrder", null);
exports.AdminPosResolver = AdminPosResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __param(0, (0, common_1.Inject)(pos_session_service_1.PosSessionService)),
    __param(1, (0, common_1.Inject)(core_1.AdministratorService)),
    __param(2, (0, common_1.Inject)(pos_order_service_1.PosOrderService)),
    __param(3, (0, common_1.Inject)(shift_report_service_1.ShiftReportService)),
    __param(4, (0, common_1.Inject)(aggregate_pay_service_1.AggregatePayService)),
    __metadata("design:paramtypes", [pos_session_service_1.PosSessionService,
        core_1.AdministratorService,
        pos_order_service_1.PosOrderService,
        shift_report_service_1.ShiftReportService,
        aggregate_pay_service_1.AggregatePayService])
], AdminPosResolver);
//# sourceMappingURL=admin-pos.resolver.js.map