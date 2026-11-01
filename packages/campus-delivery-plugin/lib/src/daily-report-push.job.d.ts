import { OnApplicationShutdown } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { FeishuClient } from './feishu/feishu.client';
/**
 * 商家每日日报推送（§86）：店铺开启后，每天到设定时间（默认 21:30）把「昨日报表」推到店铺群。
 * - 口径与经营设置页「今日/近 7 日」一致：deliveryStatus='delivered' 按 deliveredAt 归日，取消单不计入。
 * - 幂等：Channel.waimaiDailyPushLastDate 记已推送的校园日；同一天只推一条，改时间不会重复推。
 * - 未启用 / 未到点 / 今日已推过 都跳过；推送失败只告警不写 lastDate，下一轮重试。
 * - 重试上限（§118）：同一渠道同一天失败满 3 次即放弃（保留 lastDate 不写），次日重新计次。
 * - 渠道间用咨询锁隔离，多实例部署不重复推送。
 */
export declare class DailyReportPushJob implements OnApplicationShutdown {
    private connection;
    private feishu;
    private fallback;
    /** 当日失败计数（§118）：channelId → { 校园日, 次数 }；仅进程内，多实例各自计次 */
    private attempts;
    constructor(connection: TransactionalConnection, feishu: FeishuClient);
    start(): void;
    stop(): void;
    onApplicationShutdown(): void;
    /** 扫描全部启用了日报推送的渠道（未配置飞书发送能力时整体跳过，避免空转） */
    run(): Promise<void>;
    private runChannelWithLock;
    runChannel(channelId: number): Promise<void>;
    /** 昨日日报（校园时区自然日；口径同经营设置页 revenue：deliveredAt 归日） */
    private buildReport;
    /** 文本日报：金额分转元；无数据的行整行省略，避免「—」噪声 */
    private renderText;
    /** 'HH:MM' 归一；为空/非法按 21:30（写入口已校验，这里只做兜底） */
    private normalizeTime;
    private minutesOf;
    /** 校园时区（UTC+8）小时 0-23，无效时间返回 null */
    private campusHourOf;
}
