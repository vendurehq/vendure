import { Request, Response } from 'express';
import { OrderService, ChannelService, TransactionalConnection } from '@vendure/core';
import { AlipayPluginOptions } from './types';
export declare class AlipayController {
    private options;
    private orderService;
    private channelService;
    private connection;
    constructor(options: AlipayPluginOptions, orderService: OrderService, channelService: ChannelService, connection: TransactionalConnection);
    /**
     * 结算订单支付。失败必须抛错（外层返回 failure）触发支付宝重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，重复通知天然幂等。
     */
    private settleOrderPayment;
    notify(req: Request, res: Response, body: any): Promise<void>;
}
