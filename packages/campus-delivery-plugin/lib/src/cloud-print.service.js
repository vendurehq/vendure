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
exports.CloudPrintService = void 0;
exports.buildTicketContent = buildTicketContent;
/**
 * 云打印（P1-4）：把小票直接推到商家云打印机（飞鹅 / 易联云），商家无需常开工作台页面。
 *
 * 与本地 LODOP 的关系：printProvider='local' 仍走前端 C-Lodop（商家电脑装服务）；
 * 'feie' / 'yilianyun' 由服务端签名直连服务商 OpenAPI，成功即回写 waimaiPrintedAt，
 * 并落一条 campus_print_job 任务留痕（后台可看失败原因并重打）。
 *
 * 安全：密钥只在服务端使用，签名按服务商文档（飞鹅 SHA1(user+ukey+stime)；
 * 易联云 MD5(client_id+timestamp+client_secret)），密钥/账号不进日志。
 */
const crypto_1 = require("crypto");
const db_now_wall_1 = require("./db-now-wall");
const core_1 = require("@vendure/core");
const common_1 = require("@nestjs/common");
const campus_config_service_1 = require("./campus-config.service");
const campus_building_entity_1 = require("./campus-building.entity");
const campus_print_job_entity_1 = require("./campus-print-job.entity");
const hall_service_1 = require("./hall.service");
const addon_fee_1 = require("./addon-fee");
const FEIE_ENDPOINT = 'https://api.feieyun.cn/Api/Open/';
const YLY_OAUTH_ENDPOINT = 'https://open-api.10ss.net/oauth/oauth';
const YLY_PRINT_ENDPOINT = 'https://open-api.10ss.net/print/index';
const HTTP_TIMEOUT_MS = 8000;
const money = (fen) => (fen / 100).toFixed(2);
/** 服务商内容均为 HTML 片段：转义商品名里的尖括号/&，避免把话术当标签解析 */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function pad2(n) {
    return String(n).padStart(2, '0');
}
/** 小票时间按校园时区（UTC+8）展示，避免服务器时区漂移 */
function campusTimeText(d) {
    const t = new Date(d.getTime() + 8 * 3600 * 1000);
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}
/** 58mm 纯文本小票（服务商按 <BR> 换行） */
function buildTicketContent(d) {
    var _a;
    const rows = [];
    rows.push(`<CB>${esc((_a = d.title) !== null && _a !== void 0 ? _a : d.storeName)}</CB>`);
    if (!d.title && d.storePhone)
        rows.push(esc(d.storePhone));
    rows.push('--------------------------------');
    rows.push(`单号：${esc(d.code)}`);
    rows.push(`时间：${d.createdAtText}`);
    if (d.route)
        rows.push(`路线：${esc(d.route)}`);
    if (d.zone || d.building)
        rows.push(`送达：${esc(d.zone)} ${esc(d.building)}`);
    if (d.slotText)
        rows.push(`时段：${esc(d.slotText)}`);
    rows.push('--------------------------------');
    for (const l of d.lines) {
        rows.push(`${esc(l.name)} x${l.quantity}    ¥${money(l.price * l.quantity)}`);
        if (l.addons.length)
            rows.push(`  加料：${esc(l.addons.join(' / '))}`);
    }
    rows.push('--------------------------------');
    rows.push(`小计：¥${money(d.subtotal)}`);
    rows.push(`配送费：¥${money(d.shipping)}`);
    rows.push(`<B>合计：¥${money(d.total)}</B>`);
    if (d.note) {
        rows.push('--------------------------------');
        rows.push(`备注：${esc(d.note)}`);
    }
    rows.push('--------------------------------');
    rows.push(`谢谢惠顾，欢迎再次光临`);
    return rows.join('<BR>');
}
let CloudPrintService = class CloudPrintService {
    constructor(connection, config, hall) {
        this.connection = connection;
        this.config = config;
        this.hall = hall;
        /** 易联云 access_token 缓存（按 client_id），提前 5 分钟过期重取 */
        this.ylyTokens = new Map();
    }
    /** 云打印一张订单小票：失败不抛给调用方（自动触发时不能因打印机故障卡住接单） */
    async printOrder(ctx, orderId, trigger) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const order = await this.connection.getRepository(ctx, core_1.Order).findOne({
            where: { id: orderId },
            relations: ['channels', 'lines', 'lines.productVariant'],
        });
        if (!order)
            throw new core_1.UserInputError('订单不存在');
        const inChannel = (_a = order.channels) === null || _a === void 0 ? void 0 : _a.some(c => String(c.id) === String(ctx.channelId));
        if (!inChannel)
            throw new core_1.UserInputError('订单不存在或不属于当前店铺');
        const cfg = await this.config.getConfig(ctx);
        const provider = String((_b = cfg.printProvider) !== null && _b !== void 0 ? _b : 'local');
        if (provider === 'local') {
            return { ok: false, provider, dryRun: false, jobId: null, error: '当前店铺使用本地打印（C-Lodop），无需云打印' };
        }
        const cf = order.customFields;
        const buildingName = cf.buildingId
            ? await this.connection.getRepository(ctx, campus_building_entity_1.CampusBuilding).findOne({ where: { id: cf.buildingId } })
            : null;
        const data = {
            storeName: (_d = (_c = ctx.channel) === null || _c === void 0 ? void 0 : _c.code) !== null && _d !== void 0 ? _d : '',
            storePhone: (_e = cfg.storePhone) !== null && _e !== void 0 ? _e : null,
            code: order.code,
            // 小票上的下单时间：order.createdAt 是 DB now() 写入的 UTC 墙钟，先还原再按北京时区打印
            createdAtText: campusTimeText((0, db_now_wall_1.dbNowWallToInstant)(order.createdAt)),
            zone: String((_f = cf.campusZone) !== null && _f !== void 0 ? _f : ''),
            building: (_g = buildingName === null || buildingName === void 0 ? void 0 : buildingName.name) !== null && _g !== void 0 ? _g : '',
            slotText: String((_h = cf.deliverySlotText) !== null && _h !== void 0 ? _h : ''),
            route: String((_j = cf.fulfillmentRoute) !== null && _j !== void 0 ? _j : ''),
            note: (_k = cf.note) !== null && _k !== void 0 ? _k : null,
            lines: ((_l = order.lines) !== null && _l !== void 0 ? _l : []).map(l => {
                var _a, _b, _c;
                const addonsText = (0, addon_fee_1.addonDisplayText)((_a = l.customFields) === null || _a === void 0 ? void 0 : _a.waimaiAddons);
                return {
                    name: (_c = (_b = l.productVariant) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : '',
                    quantity: l.quantity,
                    price: l.unitPrice,
                    addons: addonsText ? addonsText.split(' / ') : [],
                };
            }),
            subtotal: ((_m = order.lines) !== null && _m !== void 0 ? _m : []).reduce((s, l) => s + l.unitPrice * l.quantity, 0),
            shipping: order.shipping,
            total: order.total,
        };
        const result = await this.dispatch(ctx, provider, data, Number((_o = cfg.printCopies) !== null && _o !== void 0 ? _o : 1), trigger, order.id);
        if (result.ok) {
            // 打印回执：与前端 LODOP 打印同源，防重打 + 补打依据
            await this.hall.updateOrder(ctx, order.id, {
                customFields: { waimaiPrintedAt: new Date() },
            });
        }
        return result;
    }
    /** 测试打印：不绑定订单，仅验证账号/设备/签名是否可用 */
    async testPrint(ctx) {
        var _a, _b, _c, _d, _e, _f;
        const cfg = await this.config.getConfig(ctx);
        const provider = String((_a = cfg.printProvider) !== null && _a !== void 0 ? _a : 'local');
        if (provider === 'local') {
            return { ok: false, provider, dryRun: false, jobId: null, error: '当前为本地打印通道，请在商家工作台点「补打」验证 C-Lodop' };
        }
        const now = new Date();
        const data = {
            storeName: (_c = (_b = ctx.channel) === null || _b === void 0 ? void 0 : _b.code) !== null && _c !== void 0 ? _c : '',
            storePhone: (_d = cfg.storePhone) !== null && _d !== void 0 ? _d : null,
            code: 'TEST-PRINT',
            createdAtText: campusTimeText(now),
            zone: '',
            building: '',
            slotText: '',
            route: '',
            note: null,
            lines: [{ name: '云打印测试', quantity: 1, price: 0, addons: [] }],
            subtotal: 0,
            shipping: 0,
            total: 0,
            title: `打印测试 · ${(_f = (_e = ctx.channel) === null || _e === void 0 ? void 0 : _e.code) !== null && _f !== void 0 ? _f : ''}`,
        };
        return this.dispatch(ctx, provider, data, 1, 'test', null);
    }
    /** 最近打印任务（后台排障：失败原因、耗时、是否模拟） */
    async recentJobs(ctx, limit) {
        const take = Math.min(Math.max(Number(limit !== null && limit !== void 0 ? limit : 20) || 20, 1), 100);
        const jobs = await this.connection.getRepository(ctx, campus_print_job_entity_1.CampusPrintJob).find({
            where: { channelId: ctx.channelId },
            order: { id: 'DESC' },
            take,
        });
        const orderIds = [...new Set(jobs.map(j => Number(j.orderId)).filter(n => n > 0))];
        const orders = orderIds.length
            ? await this.connection.getRepository(ctx, core_1.Order).findByIds(orderIds)
            : [];
        const codeById = new Map(orders.map(o => [String(o.id), o.code]));
        return jobs.map(j => {
            var _a, _b, _c, _d;
            return ({
                id: String(j.id),
                orderId: j.orderId ? String(j.orderId) : null,
                orderCode: j.orderId ? (_a = codeById.get(String(j.orderId))) !== null && _a !== void 0 ? _a : null : null,
                provider: j.provider,
                deviceSn: (_b = j.deviceSn) !== null && _b !== void 0 ? _b : null,
                status: j.status,
                triggerType: j.triggerType,
                copies: j.copies,
                dryRun: j.dryRun,
                errorMessage: (_c = j.errorMessage) !== null && _c !== void 0 ? _c : null,
                durationMs: (_d = j.durationMs) !== null && _d !== void 0 ? _d : null,
                createdAt: j.createdAt,
            });
        });
    }
    /** 统一落任务 + 调服务商：任何异常都收敛为任务失败，不向上抛错 */
    async dispatch(ctx, provider, data, copies, trigger, orderId) {
        var _a, _b, _c, _d, _e;
        const cfg = await this.config.getConfig(ctx);
        const repo = this.connection.getRepository(ctx, campus_print_job_entity_1.CampusPrintJob);
        const content = buildTicketContent(data);
        const safeCopies = Math.min(Math.max(Number(copies) || 1, 1), 5);
        const job = await repo.save(new campus_print_job_entity_1.CampusPrintJob({
            orderId: orderId ? Number(orderId) : null,
            channelId: ctx.channelId,
            provider,
            deviceSn: (_a = cfg.printDeviceSn) !== null && _a !== void 0 ? _a : null,
            status: 'pending',
            triggerType: trigger,
            copies: safeCopies,
            content,
        }));
        const startedAt = Date.now();
        try {
            const account = String((_b = cfg.printAccount) !== null && _b !== void 0 ? _b : '').trim();
            const sn = String((_c = cfg.printDeviceSn) !== null && _c !== void 0 ? _c : '').trim();
            const key = String((_d = cfg.printDeviceKey) !== null && _d !== void 0 ? _d : '').trim();
            if (!account || !sn || !key) {
                throw new Error('云打印未配置：请填写服务商账号、设备编号与密钥');
            }
            if (provider === 'feie') {
                await this.sendFeie(account, key, sn, content, safeCopies);
            }
            else if (provider === 'yilianyun') {
                await this.sendYilianyun(account, key, sn, content);
            }
            else {
                throw new Error(`不支持的打印通道: ${provider}`);
            }
            job.status = 'ok';
            job.dryRun = false;
            job.errorMessage = null;
            job.durationMs = Date.now() - startedAt;
            await repo.save(job);
            return { ok: true, provider, dryRun: false, jobId: String(job.id), error: null };
        }
        catch (e) {
            job.status = 'failed';
            job.errorMessage = String((_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e).slice(0, 500);
            job.durationMs = Date.now() - startedAt;
            await repo.save(job);
            // eslint-disable-next-line no-console
            console.error(`[CloudPrint] ${provider} print failed (job ${job.id}):`, job.errorMessage);
            return { ok: false, provider, dryRun: false, jobId: String(job.id), error: job.errorMessage };
        }
    }
    /** 飞鹅云：Open_printMsg（sig=SHA1(user+ukey+stime)） */
    async sendFeie(user, ukey, sn, content, times) {
        var _a;
        const stime = String(Math.floor(Date.now() / 1000));
        const sig = (0, crypto_1.createHash)('sha1').update(`${user}${ukey}${stime}`).digest('hex');
        const body = new URLSearchParams({
            user,
            ukey,
            stime,
            sig,
            apiname: 'Open_printMsg',
            sn,
            content,
            times: String(times),
        });
        const json = await this.postForm(FEIE_ENDPOINT, body);
        // 飞鹅成功返回 ret=0；非 0 时 msg 即失败原因（设备离线/编号不存在/密钥错等）
        if (Number(json === null || json === void 0 ? void 0 : json.ret) !== 0)
            throw new Error(`飞鹅打印失败：${(_a = json === null || json === void 0 ? void 0 : json.msg) !== null && _a !== void 0 ? _a : '未知返回'}`);
    }
    /** 易联云：oauth 取 token → print/index（sign=MD5(client_id+timestamp+client_secret)） */
    async sendYilianyun(clientId, clientSecret, machineCode, content) {
        var _a;
        const token = await this.yilianToken(clientId, clientSecret);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const sign = (0, crypto_1.createHash)('md5').update(`${clientId}${timestamp}${clientSecret}`).digest('hex');
        const body = new URLSearchParams({
            client_id: clientId,
            access_token: token,
            machine_code: machineCode,
            content,
            origin_id: `campus-${Date.now()}`,
            sign,
            timestamp,
            id: (0, crypto_1.randomUUID)(),
        });
        const json = await this.postForm(YLY_PRINT_ENDPOINT, body);
        if (Number(json === null || json === void 0 ? void 0 : json.error) !== 0)
            throw new Error(`易联云打印失败：${(_a = json === null || json === void 0 ? void 0 : json.error_description) !== null && _a !== void 0 ? _a : '未知返回'}`);
    }
    async yilianToken(clientId, clientSecret) {
        var _a, _b, _c, _d;
        const cached = this.ylyTokens.get(clientId);
        if (cached && cached.expiresAt > Date.now())
            return cached.token;
        const timestamp = String(Math.floor(Date.now() / 1000));
        const sign = (0, crypto_1.createHash)('md5').update(`${clientId}${timestamp}${clientSecret}`).digest('hex');
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            scope: 'all',
            client_id: clientId,
            timestamp,
            sign,
            id: (0, crypto_1.randomUUID)(),
        });
        const json = await this.postForm(YLY_OAUTH_ENDPOINT, body);
        const token = (_a = json === null || json === void 0 ? void 0 : json.body) === null || _a === void 0 ? void 0 : _a.access_token;
        if (Number(json === null || json === void 0 ? void 0 : json.error) !== 0 || !token) {
            throw new Error(`易联云取 token 失败：${(_b = json === null || json === void 0 ? void 0 : json.error_description) !== null && _b !== void 0 ? _b : '未知返回'}`);
        }
        const expiresIn = Number((_d = (_c = json === null || json === void 0 ? void 0 : json.body) === null || _c === void 0 ? void 0 : _c.expires_in) !== null && _d !== void 0 ? _d : 2592000) * 1000;
        this.ylyTokens.set(clientId, { token, expiresAt: Date.now() + Math.max(expiresIn - 5 * 60 * 1000, 60000) });
        return token;
    }
    /** 带超时的表单 POST：服务商接口不可用时最多阻塞 8s，避免拖慢接单 */
    async postForm(url, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
                signal: controller.signal,
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            try {
                return JSON.parse(text);
            }
            catch (_a) {
                throw new Error(`返回非 JSON：${text.slice(0, 120)}`);
            }
        }
        catch (e) {
            if ((e === null || e === void 0 ? void 0 : e.name) === 'AbortError')
                throw new Error('打印服务商接口超时（8s）');
            throw e;
        }
        finally {
            clearTimeout(timer);
        }
    }
};
exports.CloudPrintService = CloudPrintService;
exports.CloudPrintService = CloudPrintService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        campus_config_service_1.CampusConfigService,
        hall_service_1.HallService])
], CloudPrintService);
//# sourceMappingURL=cloud-print.service.js.map