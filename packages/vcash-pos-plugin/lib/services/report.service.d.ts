import { RequestContext } from '@vendure/core';
import { Connection } from 'typeorm';
/**
 * 报表查询服务（店长/老板维度，全店数据）。
 *
 * 四类报表：
 * 1. todayOverview - 今日概览（销售额、订单数、客单价、支付方式汇总、退款额）
 * 2. salesReport   - 日/区间报表（按天分组的销售额趋势）
 * 3. monthlyReport - 月度报表（月度汇总 + 上月环比）
 * 4. topProducts   - 商品销量 TOP（按数量或金额排序）
 *
 * 数据来源：Order + OrderLine + Payment（Vendure 原生表）
 * 金额单位：分（int），前端展示时除以 100
 * 多门店：ctx.channelId 自动过滤
 *
 * 性能说明：MVP 用 QueryBuilder + JS 端聚合，数据量大时可改为 raw SQL + DB 端 GROUP BY
 */
export declare class ReportService {
    private connection;
    constructor(connection: Connection);
    /**
     * 今日概览。
     * @param ctx RequestContext（用于 channelId 过滤）
     * @returns 今日销售额、订单数、客单价、支付方式汇总、退款额
     */
    todayOverview(ctx: RequestContext): Promise<TodayOverview>;
    /**
     * 日/区间报表（按天分组的销售额趋势）。
     * @param ctx RequestContext
     * @param startDate 起始日期（YYYY-MM-DD）
     * @param endDate 结束日期（YYYY-MM-DD，含当天）
     * @returns 按天分组的销售额、订单数、客单价
     */
    salesReport(ctx: RequestContext, startDate: string, endDate: string): Promise<SalesReport>;
    /**
     * 月度报表（月度汇总 + 上月环比）。
     * @param ctx RequestContext
     * @param year 年份（如 2026）
     * @param month 月份（1-12）
     * @returns 当月汇总 + 上月数据 + 环比变化率
     */
    monthlyReport(ctx: RequestContext, year: number, month: number): Promise<MonthlyReport>;
    /**
     * 商品销量 TOP。
     * @param ctx RequestContext
     * @param startDate 起始日期
     * @param endDate 结束日期
     * @param limit 返回条数，默认 20
     * @param sortBy 排序方式：quantity（销量）或 amount（金额）
     * @returns 商品销量排行
     */
    topProducts(ctx: RequestContext, startDate: string, endDate: string, limit?: number, sortBy?: 'quantity' | 'amount'): Promise<TopProductReport>;
    /**
     * 将 Vendure ID（形如 'T_1'）转为纯数字字符串。
     */
    private parseChannelId;
    /**
     * 查询指定日期范围 + orderType 的订单（含 payments 关系）。
     *
     * Vendure Order 通过 channels 多对多关系关联 Channel（无 channelId 外键列），
     * 因此用 innerJoin channels 过滤。customFields 是 embedded entity，
     * 列名形如 customFields_orderType，用 PRAGMA 动态查找避免命名策略差异。
     */
    private queryOrdersByDateRange;
    /**
     * 聚合支付方式（按 Payment.method 分组，仅统计 Settled 状态）。
     */
    private aggregatePaymentsByMethod;
    /**
     * 获取今日 00:00:00 ~ 明日 00:00:00 的时间范围。
     */
    private getTodayRange;
    /**
     * 解析日期范围字符串（YYYY-MM-DD），返回 Date 对象。
     * endDate 含当天（结束时间为次日 00:00:00）。
     */
    private parseDateRange;
    /**
     * 获取月份范围（该月 1 日 ~ 下月 1 日）。
     */
    private getMonthRange;
    /**
     * 格式化日期为 YYYY-MM-DD。
     */
    private formatDate;
}
export interface PaymentMethodSummary {
    method: string;
    count: number;
    amount: number;
}
export interface TodayOverview {
    date: string;
    totalAmount: number;
    orderCount: number;
    avgOrderValue: number;
    refundAmount: number;
    refundCount: number;
    paymentsByMethod: PaymentMethodSummary[];
}
export interface DailySales {
    date: string;
    totalAmount: number;
    orderCount: number;
    avgOrderValue: number;
}
export interface SalesReport {
    startDate: string;
    endDate: string;
    totalAmount: number;
    totalOrders: number;
    avgOrderValue: number;
    daily: DailySales[];
}
export interface MonthlyReport {
    year: number;
    month: number;
    totalAmount: number;
    orderCount: number;
    avgOrderValue: number;
    prevMonth: {
        totalAmount: number;
        orderCount: number;
    };
    amountChangeRate: number;
    countChangeRate: number;
}
export interface TopProductItem {
    variantId: string;
    variantName: string;
    productName: string;
    sku: string;
    totalQuantity: number;
    totalAmount: number;
}
export interface TopProductReport {
    startDate: string;
    endDate: string;
    items: TopProductItem[];
}
