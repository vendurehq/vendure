import { OnApplicationBootstrap } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
/**
 * 启动自检：
 * 1. 数据库 now() 与 Node Date.now() 偏差 > 60 秒打 error。
 * 2. 库里是否又出现 `timestamp without time zone` 列（时区归一后应为 0），发现即 error + 飞书告警。
 *
 * 目的：尽早暴露「进程 TZ / 数据库 TimeZone / 宿主时区」不一致，以及新表/新迁移重新引入
 * 无时区列。这类问题不会报错，只会让业务时间判断悄悄偏移（典型为 8 小时）。
 *
 * 两条自检都只告警、不抛错、不阻塞启动：新建表当天不能把服务卡死。
 */
export declare class TimezoneDriftCheck implements OnApplicationBootstrap {
    private connection;
    constructor(connection: TransactionalConnection);
    onApplicationBootstrap(): Promise<void>;
    /** 时区列自检：`timestamp without time zone` 应为 0；发现即 error + 飞书告警，但不阻断启动 */
    private checkLegacyTimestampColumns;
    /** tenant_access_token 缓存（提前 5 分钟过期），避免频繁取 token */
    private static appToken?;
    /**
     * 告警通道：webhook 优先（保持原有自定义机器人模式）；
     * 未配置 webhook 时走自建应用模式（tenant_access_token + 指定 chat_id）。
     */
    private notifyFeishu;
    /** 群自定义机器人 webhook（与 FeishuClient 同一签名算法） */
    private notifyViaWebhook;
    /** 自建应用模式：tenant_access_token -> im/v1/messages（receive_id_type=chat_id） */
    private notifyViaApp;
    private tenantToken;
}
