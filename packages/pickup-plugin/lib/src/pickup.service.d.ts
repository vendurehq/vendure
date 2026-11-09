import { AdministratorService, FulfillmentService, ID, Order, OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
import { Shop } from '@vendure/shop-plugin';
import { PickupPluginOptions } from './constants';
import { PickupRedemption } from './pickup-redemption.entity';
export declare class PickupService {
    private options;
    private connection;
    private orderService;
    private fulfillmentService;
    private administratorService;
    constructor(options: PickupPluginOptions, connection: TransactionalConnection, orderService: OrderService, fulfillmentService: FulfillmentService, administratorService: AdministratorService);
    private genCode;
    private genUniqueCode;
    requireMyOrder(ctx: RequestContext, orderId: ID): Promise<Order>;
    requireMyShop(ctx: RequestContext): Promise<Shop>;
    /** 收款判定（唯一真源）：online 恒已收；cod 看人工 confirmation。 */
    effectiveCollected(redemption: PickupRedemption): boolean;
    /** 是否到店收银单（下单时未收款，需店员提货时确认收款）。 */
    private isArriveStorePayment;
    /**
     * 核销码生成资格：deliveryType=pickup 且已过「加购/付款中」阶段。
     * online → 需已结算（PaymentSettled 及之后）；cod（到店付款/货到付款）→ 授权即视为可核销，
     * 收款在核销完成时由店员确认（解决 PaymentAuthorized 不生成码的问题）。
     */
    private isPickupEligible;
    /**
     * 店归属强校验：被核销订单主商品的 Product.customFields.shopId 归店（与 settlement-plugin 阶段24
     * 按店拆账同一判据）。订单任一行商品归属本店即视为本店单，否则不归属。
     */
    private orderBelongsToShop;
    /** 懒生成/取回固定提货码（幂等：一生对一单）。 */
    resolveMyPickupCode(ctx: RequestContext, orderId: ID): Promise<PickupRedemption>;
    private getOrCreateRedemption;
    /**
     * 为「已付款的 pickup 订单」幂等生成提货码（自动生码；供事件订阅与游客查询兜底调用）。
     * 非 pickup 或未过支付闸门（isPickupEligible：cod 授权即过）则不生成。
     */
    ensurePickupRedemptionForOrder(ctx: RequestContext, orderId: ID): Promise<void>;
    /** 核销闸门：校验凭据存在且 generated。 */
    private findGeneratable;
    /** 顾客自核销：仅线上已收款单可自助核销；到店付款单必须到店由店员收款核销（防漏收）。 */
    claimMyPickup(ctx: RequestContext, orderId: ID, code: string): Promise<PickupRedemption>;
    /** 店员核销（仅本店订单，跨店抛 Forbidden）。到店付款单必须确认收款（collect=true）后才放行，防漏收。 */
    claimPickupByShop(ctx: RequestContext, code: string, collect?: boolean): Promise<PickupRedemption>;
    /**
     * 到店自取 COD 柜台收款：核销完成后登记现金收款台账（金额=本单 COD 应收）。
     * 台账能力由 campus-delivery-plugin 注册；未安装时不阻断核销，仅告警由人工补录。
     */
    private recordCodCollection;
    /** 店员核销凭据（到店或线上单通用）。仅设置 order.collected 与 redemption.collected。 */
    private commitRedeem;
    onOrderCancelled(orderId: number): Promise<void>;
    /** 店主域：本店待核销 pickup 凭据（generated，且订单主商品归本店）。返回 [items, totalItems] 供 resolver 解构。 */
    myPickupOrders(ctx: RequestContext, options?: any): Promise<[PickupRedemption[], number]>;
    private listRedemptions;
    allRedemptions(ctx: RequestContext, options?: any): Promise<{
        items: PickupRedemption[];
        totalItems: number;
    }>;
}
