import { OnApplicationBootstrap } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
/**
 * 启动自检：数据库 now() 与 Node Date.now() 偏差 > 60 秒打 error。
 *
 * 目的：尽早暴露「进程 TZ / 数据库 TimeZone / 宿主时区」不一致。
 * 这类不一致会让 `timestamp without time zone` 列与 `now()` / JS `Date.now()` 的比较
 * 出现整体偏移（典型为 8 小时），且不会报错，只会让业务判断悄悄错。
 */
export declare class TimezoneDriftCheck implements OnApplicationBootstrap {
    private connection;
    constructor(connection: TransactionalConnection);
    onApplicationBootstrap(): Promise<void>;
}
