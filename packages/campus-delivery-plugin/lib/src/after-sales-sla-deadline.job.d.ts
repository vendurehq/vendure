import { OnApplicationShutdown } from '@nestjs/common';
import { Channel, TransactionalConnection } from '@vendure/core';
import { CampusConfigService } from './campus-config.service';
/**
 * 售后 SLA 截止时间重算（§99）：把「申请时间 + 处理时限」换算成营业时段感知的截止时间，
 * 写入 after_sales_request.slaDeadlineAt，供列表筛选、工作台统计、处理人负载、报表统一使用。
 * - 未配置营业时间（或配置无法解析）时等价于申请时间 + 时限 + 暂停累计。
 * - 重算本身幂等，但多实例同跑会放大读写压力并重复读渠道配置，故仍以咨询锁串行化。
 */
export declare class AfterSalesSlaDeadlineJob implements OnApplicationShutdown {
    private connection;
    private config;
    private fallback;
    constructor(connection: TransactionalConnection, config: CampusConfigService);
    start(): void;
    stop(): void;
    onApplicationShutdown(): void;
    run(): Promise<void>;
    runChannel(channel: Channel): Promise<void>;
}
