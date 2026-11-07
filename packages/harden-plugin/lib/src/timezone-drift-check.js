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
var TimezoneDriftCheck_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimezoneDriftCheck = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
/** 允许的最大偏差：超过即打 error（仅告警，不阻断启动） */
const DRIFT_LIMIT_MS = 60000;
/** 告警文本最多列出的列名数量 */
const MAX_REPORTED_COLUMNS = 20;
/** 飞书 webhook 推送超时 */
const FEISHU_TIMEOUT_MS = 5000;
/** 飞书 API 请求（统一超时；不抛错，由调用方判定成功与否） */
async function feishuFetch(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FEISHU_TIMEOUT_MS);
    try {
        return await fetch(url, Object.assign(Object.assign({}, init), { signal: ctrl.signal }));
    }
    finally {
        clearTimeout(timer);
    }
}
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
let TimezoneDriftCheck = TimezoneDriftCheck_1 = class TimezoneDriftCheck {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        var _a, _b, _c, _d;
        try {
            const before = Date.now();
            const rows = await this.connection.rawConnection.query(`SELECT now() AS db_now, current_setting('TimeZone') AS db_tz`);
            const after = Date.now();
            const row = (_b = (Array.isArray(rows) ? rows[0] : (_a = rows === null || rows === void 0 ? void 0 : rows.rows) === null || _a === void 0 ? void 0 : _a[0])) !== null && _b !== void 0 ? _b : {};
            const dbNowMs = new Date(row.db_now).getTime();
            // 网络往返让 DB now() 略早于 after，取调用前后中点做近似
            const nodeNowMs = (before + after) / 2;
            const driftMs = Math.abs(dbNowMs - nodeNowMs);
            const processTz = (_c = process.env.TZ) !== null && _c !== void 0 ? _c : '(未设置)';
            const processTzOffsetMin = new Date().getTimezoneOffset();
            if (driftMs > DRIFT_LIMIT_MS) {
                core_1.Logger.error(`时区自检失败：DB now() 与 Node Date.now() 偏差 ${driftMs}ms (>${DRIFT_LIMIT_MS}ms)；`
                    + `DB TimeZone=${row.db_tz}，进程 TZ=${processTz}（offset ${processTzOffsetMin}min）`, constants_1.loggerCtx);
            }
            else {
                core_1.Logger.info(`时区自检通过：偏差 ${driftMs}ms；DB TimeZone=${row.db_tz}，`
                    + `进程 TZ=${processTz}（offset ${processTzOffsetMin}min）`, constants_1.loggerCtx);
            }
        }
        catch (e) {
            // 自检失败不能阻断启动
            core_1.Logger.warn(`时区自检跳过（无法查询 now()）：${String((_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e)}`, constants_1.loggerCtx);
        }
        await this.checkLegacyTimestampColumns();
    }
    /** 时区列自检：`timestamp without time zone` 应为 0；发现即 error + 飞书告警，但不阻断启动 */
    async checkLegacyTimestampColumns() {
        var _a, _b;
        try {
            const rows = await this.connection.rawConnection.query(`SELECT table_name, column_name
                   FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND data_type = 'timestamp without time zone'
                  ORDER BY table_name, ordinal_position`);
            const list = (_a = (Array.isArray(rows) ? rows : rows === null || rows === void 0 ? void 0 : rows.rows)) !== null && _a !== void 0 ? _a : [];
            const count = list.length;
            if (count === 0) {
                core_1.Logger.info('时区列自检通过：timestamp without time zone 列数 0', constants_1.loggerCtx);
                return;
            }
            const shown = list.slice(0, MAX_REPORTED_COLUMNS)
                .map(r => `${r.table_name}.${r.column_name}`)
                .join(', ');
            const more = count > MAX_REPORTED_COLUMNS ? ` …（共 ${count} 列，仅列前 ${MAX_REPORTED_COLUMNS}）` : '';
            const text = `时区列自检失败：发现 ${count} 个 timestamp without time zone 列（应为 0）：${shown}${more}`;
            core_1.Logger.error(text, constants_1.loggerCtx);
            await this.notifyFeishu(`【时区护栏】${text}`);
        }
        catch (e) {
            // 自检失败不能阻断启动
            core_1.Logger.warn(`时区列自检跳过（无法查询 information_schema）：${String((_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e)}`, constants_1.loggerCtx);
        }
    }
    /**
     * 告警通道：webhook 优先（保持原有自定义机器人模式）；
     * 未配置 webhook 时走自建应用模式（tenant_access_token + 指定 chat_id）。
     */
    async notifyFeishu(text) {
        var _a, _b, _c, _d, _e, _f, _g;
        const enabled = /^(true|1)$/i.test(String((_a = process.env.FEISHU_ENABLED) !== null && _a !== void 0 ? _a : ''));
        if (!enabled) {
            core_1.Logger.info('时区列自检告警未发送：FEISHU_ENABLED 未开启', constants_1.loggerCtx);
            return;
        }
        const webhook = (_b = process.env.FEISHU_WEBHOOK) === null || _b === void 0 ? void 0 : _b.trim();
        if (webhook) {
            await this.notifyViaWebhook(webhook, text);
            return;
        }
        // 告警专用应用优先；未单独配置时回退到通用 FEISHU_APP_ID/SECRET
        const appId = (_d = ((_c = process.env.FEISHU_ALERT_APP_ID) !== null && _c !== void 0 ? _c : process.env.FEISHU_APP_ID)) === null || _d === void 0 ? void 0 : _d.trim();
        const appSecret = (_f = ((_e = process.env.FEISHU_ALERT_APP_SECRET) !== null && _e !== void 0 ? _e : process.env.FEISHU_APP_SECRET)) === null || _f === void 0 ? void 0 : _f.trim();
        const chatId = (_g = process.env.FEISHU_ALERT_CHAT_ID) === null || _g === void 0 ? void 0 : _g.trim();
        if (!appId || !appSecret || !chatId) {
            core_1.Logger.info('时区列自检告警未发送：未配置 FEISHU_WEBHOOK，也缺少 '
                + 'FEISHU_ALERT_APP_ID/FEISHU_ALERT_APP_SECRET/FEISHU_ALERT_CHAT_ID', constants_1.loggerCtx);
            return;
        }
        await this.notifyViaApp(appId, appSecret, chatId, text);
    }
    /** 群自定义机器人 webhook（与 FeishuClient 同一签名算法） */
    async notifyViaWebhook(webhook, text) {
        var _a, _b, _c;
        try {
            const secret = (_a = process.env.FEISHU_SECRET) === null || _a === void 0 ? void 0 : _a.trim();
            const payload = { msg_type: 'text', content: { text } };
            if (secret) {
                const ts = String(Math.floor(Date.now() / 1000));
                payload.timestamp = ts;
                payload.sign = (0, node_crypto_1.createHmac)('sha256', `${ts}\n${secret}`).update('').digest('base64');
            }
            const res = await feishuFetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(payload),
            });
            const json = await res.json().catch(() => null);
            const code = (_b = json === null || json === void 0 ? void 0 : json.code) !== null && _b !== void 0 ? _b : json === null || json === void 0 ? void 0 : json.StatusCode;
            if (res.ok && (code === 0 || code === undefined)) {
                core_1.Logger.info('时区列自检告警已推送飞书（webhook）', constants_1.loggerCtx);
            }
            else {
                core_1.Logger.warn(`时区列自检告警推送失败（webhook）：HTTP ${res.status}，code=${code !== null && code !== void 0 ? code : 'n/a'}`, constants_1.loggerCtx);
            }
        }
        catch (e) {
            core_1.Logger.warn(`时区列自检告警推送异常（webhook）：${String((_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e)}`, constants_1.loggerCtx);
        }
    }
    /** 自建应用模式：tenant_access_token -> im/v1/messages（receive_id_type=chat_id） */
    async notifyViaApp(appId, appSecret, chatId, text) {
        var _a, _b, _c, _d;
        try {
            const token = await this.tenantToken(appId, appSecret);
            if (!token)
                return;
            const res = await feishuFetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    receive_id: chatId,
                    msg_type: 'text',
                    content: JSON.stringify({ text }),
                }),
            });
            const json = await res.json().catch(() => null);
            const code = json === null || json === void 0 ? void 0 : json.code;
            if (res.ok && code === 0) {
                core_1.Logger.info(`时区列自检告警已推送飞书（app）message_id=${(_b = (_a = json === null || json === void 0 ? void 0 : json.data) === null || _a === void 0 ? void 0 : _a.message_id) !== null && _b !== void 0 ? _b : 'unknown'}`, constants_1.loggerCtx);
            }
            else {
                core_1.Logger.warn(`时区列自检告警推送失败（app）：HTTP ${res.status}，`
                    + `code=${code !== null && code !== void 0 ? code : 'n/a'} msg=${(_c = json === null || json === void 0 ? void 0 : json.msg) !== null && _c !== void 0 ? _c : 'n/a'}`, constants_1.loggerCtx);
            }
        }
        catch (e) {
            core_1.Logger.warn(`时区列自检告警推送异常（app）：${String((_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e)}`, constants_1.loggerCtx);
        }
    }
    async tenantToken(appId, appSecret) {
        var _a, _b, _c, _d;
        const cached = TimezoneDriftCheck_1.appToken;
        if (cached && cached.expiresAt > Date.now())
            return cached.value;
        try {
            const res = await feishuFetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
            });
            const json = await res.json().catch(() => null);
            if (!(json === null || json === void 0 ? void 0 : json.tenant_access_token)) {
                core_1.Logger.warn(`时区列自检告警：获取 tenant_access_token 失败 code=${(_a = json === null || json === void 0 ? void 0 : json.code) !== null && _a !== void 0 ? _a : 'n/a'} `
                    + `msg=${(_b = json === null || json === void 0 ? void 0 : json.msg) !== null && _b !== void 0 ? _b : 'n/a'}`, constants_1.loggerCtx);
                return null;
            }
            const ttl = Number((_c = json.expire) !== null && _c !== void 0 ? _c : 7200) * 1000;
            TimezoneDriftCheck_1.appToken = {
                value: json.tenant_access_token,
                expiresAt: Date.now() + ttl - 5 * 60000,
            };
            return json.tenant_access_token;
        }
        catch (e) {
            core_1.Logger.warn(`时区列自检告警：获取 tenant_access_token 异常 ${String((_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e)}`, constants_1.loggerCtx);
            return null;
        }
    }
};
exports.TimezoneDriftCheck = TimezoneDriftCheck;
exports.TimezoneDriftCheck = TimezoneDriftCheck = TimezoneDriftCheck_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], TimezoneDriftCheck);
//# sourceMappingURL=timezone-drift-check.js.map