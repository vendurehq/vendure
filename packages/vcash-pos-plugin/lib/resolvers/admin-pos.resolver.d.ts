import { AdministratorService, Order, Payment, RequestContext } from '@vendure/core';
import { PosSession, ShiftSummary } from '../entities/pos-session.entity';
import { SettleSessionAggregatePaysResult } from '../types';
import { AggregatePayService } from '../services/aggregate-pay.service';
import { PosOrderService } from '../services/pos-order.service';
import { PosSessionService } from '../services/pos-session.service';
import { ShiftReportService } from '../services/shift-report.service';
/**
 * POS 收银操作 API：班次生命周期（开班/关班/我的班次）+ 交班对账预览 + 聚合码支付。
 */
export declare class AdminPosResolver {
    private sessionService;
    private administratorService;
    private orderService;
    private shiftReportService;
    private aggregatePayService;
    constructor(sessionService: PosSessionService, administratorService: AdministratorService, orderService: PosOrderService, shiftReportService: ShiftReportService, aggregatePayService: AggregatePayService);
    /**
     * 当前管理员的开班班次。
     * ctx.activeUserId 是 User.id，需先转成 Administrator.id 再查。
     */
    myPosSession(ctx: RequestContext): Promise<PosSession | null>;
    posSession(id: string): Promise<PosSession | null>;
    openSession(input: {
        terminalCode: string;
        openingFloat?: number;
    }, ctx: RequestContext): Promise<PosSession>;
    closeSession(input: {
        sessionId: string;
        closingCash?: number;
        approverId?: string;
    }): Promise<{
        session: PosSession;
        summary: any | null;
    }>;
    posActiveOrder(ctx: RequestContext): Promise<Order | null>;
    addPosItem(input: {
        productVariantId: string;
        quantity: number;
        discount?: number;
        isGift?: boolean;
        note?: string;
        originalPrice?: number;
    }, ctx: RequestContext): Promise<Order>;
    updatePosItem(input: {
        orderLineId: string;
        quantity: number;
    }, ctx: RequestContext): Promise<Order>;
    checkoutPosOrder(input: {
        payments: Array<{
            method: string;
            transactionId?: string;
            metadata?: any;
        }>;
    }, ctx: RequestContext): Promise<{
        order: Order;
        payments: any[];
    }>;
    /**
     * 交班对账单预览：不传 closingCash 则不做现金对账（warnings 为空）。
     * 用于关班前让收银员预览当前班次汇总。
     */
    shiftReportPreview(sessionId: string, closingCash?: number): Promise<ShiftSummary>;
    /**
     * 创建聚合码待支付 Payment。
     * 需当前班次有活跃 Order 且购物车非空。
     */
    createAggregatePay(input: {
        aggregatePayCode: string;
    }, ctx: RequestContext): Promise<Payment>;
    /**
     * 确认聚合码支付（客户已扫码付款）。
     * Payment: Created → Authorized
     */
    confirmAggregatePay(paymentId: string, ctx: RequestContext): Promise<Payment>;
    /**
     * 结算聚合码支付（关班时批量结算或单笔结算）。
     * Payment: Authorized → Settled
     */
    settleAggregatePay(paymentId: string, ctx: RequestContext): Promise<Payment>;
    /**
     * 标记聚合码支付失败（超时）。
     * Payment: Created → Cancelled
     */
    failAggregatePay(paymentId: string, ctx: RequestContext): Promise<Payment>;
    /**
     * 批量结算班次内所有 confirmed 状态的聚合码支付。
     * 返回 { settled, failed }，失败逐笔带原因。
     */
    settleSessionAggregatePays(sessionId: string, ctx: RequestContext): Promise<SettleSessionAggregatePaysResult>;
    /**
     * 根据聚合码查询 Payment 状态。
     */
    aggregatePayByCode(aggregatePayCode: string): Promise<Payment | null>;
    /**
     * 挂单：把当前活跃 Order 的 orderType 改为 hold，清空 activeOrderId。
     * 无参数（操作当前 session 的 activeOrder）。
     */
    holdOrder(ctx: RequestContext): Promise<Order>;
    /**
     * 取单：校验目标 Order 为 hold + 归属本终端，加载为当前 activeOrder。
     */
    resumeOrder(orderId: string, ctx: RequestContext): Promise<Order>;
    /**
     * 挂单列表：当前终端下所有 orderType=hold 的 Draft Order。
     */
    heldOrders(ctx: RequestContext): Promise<Order[]>;
    /**
     * 按订单号查询原单（退货场景入口）。Admin API 无原生 orderByCode，此处封装。
     */
    posOrderByCode(code: string, ctx: RequestContext): Promise<Order | null>;
    /**
     * 创建退货单（独立 refund Order，spec 3.10）：
     * 复制原单行为负数量 + createCancellationsForOrderLines 回库 + 现金退款 Payment。
     */
    createRefundOrder(input: {
        originalOrderId: string;
        refundLines: Array<{
            orderLineId: string;
            quantity: number;
            reason?: string;
        }>;
    }, ctx: RequestContext): Promise<{
        refundOrder: Order;
        originalOrder: Order;
    }>;
    /**
     * User.id → Administrator。失败返回 undefined（myPosSession 容忍 null，openSession 抛错）。
     */
    private resolveOperator;
}
