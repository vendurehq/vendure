// §54.6 骑手合规到期提醒：每小时扫描已通过审核的骑手，
// 健康证/保险进入 30 天预警窗口或已过期时，写一条站内信给该骑手（每位骑手每天最多一条）。
//
// 口径与后端上线闸门完全一致：直接复用 rider-compliance.ts 的 evaluateRiderCompliance，
// 不另写一套到期判断，避免「后台提示该续期、上线判定却没拦」的口径漂移。
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Channel, Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { evaluateRiderCompliance, RiderComplianceItem } from './rider-compliance';
import { campusDayKey } from './campus-time';
import { PeriodicFallback } from './periodic-fallback';

const loggerCtx = 'CampusRiderCompliance';
/** 启动后首跑延迟：等迁移补列 / DB 连接稳定 */
const BOOT_DELAY_MS = 120_000;
/** 扫描周期：60 分钟（到期提醒按天级精度即可，也天然满足「每人每天至多一条」） */
const INTERVAL_MS = 60 * 60_000;
/** 单轮最多处理骑手数，防止异常积压拖慢进程 */
const MAX_PER_RUN = 500;
/** 站内信标题固定：同日去重按「该骑手当天是否已收到同标题站内信」判断 */
const TITLE = '骑手合规到期提醒';

/**
 * 骑手合规到期提醒（§54.6）。
 * - 只提醒 healthCert / insurance 的 expiring（≤30 天）与 expired；
 *   背调失败另有上线闸门拦截，不在此处刷提醒。
 * - 去重不引入新表：按 message_delivery + message 当日已有记录判断，重复运行幂等。
 * - 单条失败只 warn 不阻断整轮。
 */
@Injectable()
export class RiderComplianceReminderJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;

    constructor(private connection: TransactionalConnection) {}

    start(): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({
            name: 'rider-compliance-reminder',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() => this.runOnce());
    }

    stop(): void {
        this.fallback?.stop();
        this.fallback = null;
    }

    onApplicationShutdown(): void {
        this.stop();
    }

    async runOnce(): Promise<void> {
        const raw = this.connection.rawConnection;
        const now = new Date();
        const since = new Date(Date.parse(`${campusDayKey(now.getTime())}T00:00:00+08:00`));
        let rows: any;
        try {
            rows = await raw.query(
                `SELECT c.id AS "customerId", cc."channelId" AS "channelId",
                        c."customFieldsRiderhealthcertno" AS "healthCertNo",
                        c."customFieldsRiderhealthcertimg" AS "healthCertImg",
                        c."customFieldsRiderhealthcertexpiry" AS "healthCertExpiry",
                        c."customFieldsRiderinsuranceno" AS "insuranceNo",
                        c."customFieldsRiderinsuranceexpiry" AS "insuranceExpiry",
                        c."customFieldsRiderbackgroundcheck" AS "backgroundCheck"
                   FROM customer c
                   JOIN customer_channels_channel cc ON cc."customerId" = c.id
                  WHERE c."customFieldsRiderstatus" = 'approved'
                    AND (c."customFieldsRiderhealthcertexpiry" IS NOT NULL
                         OR c."customFieldsRiderinsuranceexpiry" IS NOT NULL)
                  ORDER BY c.id ASC
                  LIMIT ${MAX_PER_RUN}`,
            );
        } catch (e: any) {
            // 表/列缺失（迁移未跑完）时本轮跳过，不阻断后续轮次
            Logger.warn(`query rider compliance failed: ${String(e?.message ?? e)}`, loggerCtx);
            return;
        }
        const list: any[] = this.rows(rows);
        if (!list.length) return;

        const channelCache = new Map<number, Channel | null>();
        let sent = 0;
        for (const r of list) {
            const customerId = Number(r.customerId);
            const channelId = Number(r.channelId);
            try {
                const result = evaluateRiderCompliance(
                    {
                        riderHealthCertNo: r.healthCertNo,
                        riderHealthCertImg: r.healthCertImg,
                        riderHealthCertExpiry: r.healthCertExpiry,
                        riderInsuranceNo: r.insuranceNo,
                        riderInsuranceExpiry: r.insuranceExpiry,
                        riderBackgroundCheck: r.backgroundCheck,
                    },
                    now,
                );
                const due = result.items.filter(i => this.isDue(i));
                if (!due.length) continue;
                // 同日去重：该骑手当天已收到过同标题站内信 → 本轮跳过
                const hit: any = await raw.query(
                    'SELECT 1 AS hit FROM message_delivery d '
                    + 'JOIN message m ON m.id = d."messageId" '
                    + 'WHERE d."customerId" = $1 AND m.title = $2 AND m."createdAt" >= $3 LIMIT 1',
                    [customerId, TITLE, since],
                );
                if (this.rows(hit).length) continue;
                if (!channelCache.has(channelId)) {
                    channelCache.set(
                        channelId,
                        await raw.getRepository(Channel).findOne({ where: { id: channelId } as any }),
                    );
                }
                const channel = channelCache.get(channelId);
                if (!channel) continue;
                const ctx = new RequestContext({
                    apiType: 'admin',
                    channel,
                    isAuthorized: true,
                    authorizedAsOwnerOnly: false,
                });
                const msgRepo = this.connection.getRepository(ctx, 'Message' as any);
                const deliveryRepo = this.connection.getRepository(ctx, 'MessageDelivery' as any);
                const body = `${due.map(i => this.line(i, now)).join('\n')}\n\n请尽快更新合规资料，过期后将无法上线接单。`;
                const message = await msgRepo.save(msgRepo.create({
                    title: TITLE,
                    body,
                    deliveryChannel: 'inapp',
                    audienceType: 'all',
                    status: 'sent',
                    totalTarget: 1,
                    totalSent: 1,
                    channels: [channel],
                }));
                await deliveryRepo.save(deliveryRepo.create({
                    messageId: message.id,
                    customerId,
                    deliveryStatus: 'sent',
                    channels: [channel],
                }));
                sent += 1;
            } catch (e: any) {
                Logger.warn(`remind rider ${customerId} failed: ${String(e?.message ?? e)}`, loggerCtx);
            }
        }
        if (sent > 0) Logger.info(`sent ${sent} rider compliance reminder(s)`, loggerCtx);
    }

    /** 仅到期类项目：健康证 / 保险的 30 天内到期与已过期 */
    private isDue(item: RiderComplianceItem): boolean {
        if (item.key !== 'healthCert' && item.key !== 'insurance') return false;
        return item.status === 'expiring' || item.status === 'expired';
    }

    private line(item: RiderComplianceItem, now: Date): string {
        const expiry = item.expiry ? new Date(item.expiry) : null;
        const when = expiry ? this.dayText(expiry) : '近期';
        if (item.status === 'expired') return `· ${item.label}已于 ${when} 过期，请尽快换新`;
        const days = expiry ? Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / 86400_000)) : 0;
        return `· ${item.label}将于 ${when} 到期（剩 ${days} 天），请及时续期`;
    }

    /** 校园时区（UTC+8）展示：YYYY-MM-DD */
    private dayText(d: Date): string {
        const shifted = new Date(d.getTime() + 8 * 3600_000);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
    }

    /** 兼容不同驱动的返回结构：部分驱动把结果再包一层数组 */
    private rows(result: any): any[] {
        if (!Array.isArray(result)) return [];
        return Array.isArray(result[0]) ? result[0] : result;
    }
}
