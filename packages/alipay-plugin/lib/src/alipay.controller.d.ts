import { Request, Response } from 'express';
import { OrderService, ChannelService, TransactionalConnection } from '@vendure/core';
import { AlipayPluginOptions } from './types';
export declare class AlipayController {
    private options;
    private orderService;
    private channelService;
    private connection;
    constructor(options: AlipayPluginOptions, orderService: OrderService, channelService: ChannelService, connection: TransactionalConnection);
    /** 全局按单号取单并切到订单所属渠道（回调域名/默认渠道未必是下单渠道） */
    private resolveOrder;
    /**
     * 回调内容校验：app_id / seller_id 必须与订单所属渠道（或插件）配置一致，
     * 金额必须等于某笔待结算支付的金额；任一不符即拒绝（返回 failure）。
     */
    private assertNotifyMatchesOrder;
    /**
     * 结算订单支付。失败必须抛错（外层返回 failure）触发支付宝重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，重复通知天然幂等。
     */
    private settleOrderPayment;
    private warnedMissingSellerId;
    notify(req: Request, res: Response, body: any): Promise<void>;
}
