import { OnApplicationShutdown } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
/**
 * 骑手合规到期提醒（§54.6）。
 * - 只提醒 healthCert / insurance 的 expiring（≤30 天）与 expired；
 *   背调失败另有上线闸门拦截，不在此处刷提醒。
 * - 去重不引入新表：按 message_delivery + message 当日已有记录判断，重复运行幂等。
 * - 单条失败只 warn 不阻断整轮。
 */
export declare class RiderComplianceReminderJob implements OnApplicationShutdown {
    private connection;
    private fallback;
    constructor(connection: TransactionalConnection);
    start(): void;
    stop(): void;
    onApplicationShutdown(): void;
    runOnce(): Promise<void>;
    /** 仅到期类项目：健康证 / 保险的 30 天内到期与已过期 */
    private isDue;
    private line;
    /** 校园时区（UTC+8）展示：YYYY-MM-DD */
    private dayText;
    /** 兼容不同驱动的返回结构：部分驱动把结果再包一层数组 */
    private rows;
}
