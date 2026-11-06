"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiderComplianceReminderJob = void 0;
// §54.6 骑手合规到期提醒：每小时扫描已通过审核的骑手，
// 健康证/保险进入 30 天预警窗口或已过期时，写一条站内信给该骑手（每位骑手每天最多一条）。
//
// 口径与后端上线闸门完全一致：直接复用 rider-compliance.ts 的 evaluateRiderCompliance，
// 不另写一套到期判断，避免「后台提示该续期、上线判定却没拦」的口径漂移。
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const rider_compliance_1 = require("./rider-compliance");
const campus_time_1 = require("./campus-time");
const periodic_fallback_1 = require("./periodic-fallback");
const loggerCtx = 'CampusRiderCompliance';
/** 启动后首跑延迟：等迁移补列 / DB 连接稳定 */
const BOOT_DELAY_MS = 120000;
/** 扫描周期：60 分钟（到期提醒按天级精度即可，也天然满足「每人每天至多一条」） */
const INTERVAL_MS = 60 * 60000;
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
let RiderComplianceReminderJob = class RiderComplianceReminderJob {
    constructor(connection) {
        this.connection = connection;
        this.fallback = null;
    }
    start() {
        if (this.fallback)
            return;
        this.fallback = new periodic_fallback_1.PeriodicFallback({
            name: 'rider-compliance-reminder',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() => this.runOnce());
    }
    stop() {
        var _a;
        (_a = this.fallback) === null || _a === void 0 ? void 0 : _a.stop();
        this.fallback = null;
    }
    onApplicationShutdown() {
        this.stop();
    }
    async runOnce() {
        var _a, _b;
        const raw = this.connection.rawConnection;
        const now = new Date();
        const since = new Date(Date.parse(`${(0, campus_time_1.campusDayKey)(now.getTime())}T00:00:00+08:00`));
        let rows;
        try {
            rows = await raw.query(`SELECT c.id AS "customerId", cc."channelId" AS "channelId",
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
                  LIMIT ${MAX_PER_RUN}`);
        }
        catch (e) {
            // 表/列缺失（迁移未跑完）时本轮跳过，不阻断后续轮次
            core_1.Logger.warn(`query rider compliance failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, loggerCtx);
            return;
        }
        const list = this.rows(rows);
        if (!list.length)
            return;
        const channelCache = new Map();
        let sent = 0;
        for (const r of list) {
            const customerId = Number(r.customerId);
            const channelId = Number(r.channelId);
            try {
                const result = (0, rider_compliance_1.evaluateRiderCompliance)({
                    riderHealthCertNo: r.healthCertNo,
                    riderHealthCertImg: r.healthCertImg,
                    riderHealthCertExpiry: r.healthCertExpiry,
                    riderInsuranceNo: r.insuranceNo,
                    riderInsuranceExpiry: r.insuranceExpiry,
                    riderBackgroundCheck: r.backgroundCheck,
                }, now);
                const due = result.items.filter(i => this.isDue(i));
                if (!due.length)
                    continue;
                // 同日去重：该骑手当天已收到过同标题站内信 → 本轮跳过
                const hit = await raw.query('SELECT 1 AS hit FROM message_delivery d '
                    + 'JOIN message m ON m.id = d."messageId" '
                    + 'WHERE d."customerId" = $1 AND m.title = $2 AND m."createdAt" >= $3 LIMIT 1', [customerId, TITLE, since]);
                if (this.rows(hit).length)
                    continue;
                if (!channelCache.has(channelId)) {
                    channelCache.set(channelId, await raw.getRepository(core_1.Channel).findOne({ where: { id: channelId } }));
                }
                const channel = channelCache.get(channelId);
                if (!channel)
                    continue;
                const ctx = new core_1.RequestContext({
                    apiType: 'admin',
                    channel,
                    isAuthorized: true,
                    authorizedAsOwnerOnly: false,
                });
                const msgRepo = this.connection.getRepository(ctx, 'Message');
                const deliveryRepo = this.connection.getRepository(ctx, 'MessageDelivery');
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
            }
            catch (e) {
                core_1.Logger.warn(`remind rider ${customerId} failed: ${String((_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e)}`, loggerCtx);
            }
        }
        if (sent > 0)
            core_1.Logger.info(`sent ${sent} rider compliance reminder(s)`, loggerCtx);
    }
    /** 仅到期类项目：健康证 / 保险的 30 天内到期与已过期 */
    isDue(item) {
        if (item.key !== 'healthCert' && item.key !== 'insurance')
            return false;
        return item.status === 'expiring' || item.status === 'expired';
    }
    line(item, now) {
        const expiry = item.expiry ? new Date(item.expiry) : null;
        const when = expiry ? this.dayText(expiry) : '近期';
        if (item.status === 'expired')
            return `· ${item.label}已于 ${when} 过期，请尽快换新`;
        const days = expiry ? Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / 86400000)) : 0;
        return `· ${item.label}将于 ${when} 到期（剩 ${days} 天），请及时续期`;
    }
    /** 校园时区（UTC+8）展示：YYYY-MM-DD */
    dayText(d) {
        const shifted = new Date(d.getTime() + 8 * 3600000);
        const pad = (n) => String(n).padStart(2, '0');
        return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
    }
    /** 兼容不同驱动的返回结构：部分驱动把结果再包一层数组 */
    rows(result) {
        if (!Array.isArray(result))
            return [];
        return Array.isArray(result[0]) ? result[0] : result;
    }
};
exports.RiderComplianceReminderJob = RiderComplianceReminderJob;
exports.RiderComplianceReminderJob = RiderComplianceReminderJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], RiderComplianceReminderJob);
//# sourceMappingURL=rider-compliance-reminder.job.js.map