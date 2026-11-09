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
exports.FeishuCommandService = exports.AUDIT_TABLE_SQL = void 0;
exports.parseCommand = parseCommand;
exports.requiredRole = requiredRole;
exports.buildRestoreSQL = buildRestoreSQL;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
const campus_building_entity_1 = require("../campus-building.entity");
const campus_dedupe_service_1 = require("../campus-dedupe.service");
const campus_fulfillment_config_entity_1 = require("../campus-fulfillment-config.entity");
const campus_time_1 = require("../campus-time");
const delivery_stats_service_1 = require("../delivery-stats.service");
const dispatch_admin_service_1 = require("../dispatch-admin.service");
const hall_service_1 = require("../hall.service");
const merchant_admin_service_1 = require("../merchant-admin.service");
const rider_task_service_1 = require("../rider-task.service");
const feishu_alert_windows_1 = require("./feishu.alert-windows");
const feishu_card_service_1 = require("./feishu-card.service");
const feishu_client_1 = require("./feishu.client");
const feishu_config_1 = require("./feishu.config");
const feishu_templates_1 = require("./feishu.templates");
const loggerCtx = 'Feishu';
const RATE_LIMIT_PER_MIN = 20;
const CONFIRM_TTL_MS = 5 * 60000;
const RIDER_PICK_TIMEOUT_MIN = 15;
/** 去掉 @ 占位符与首尾空白，再按首个空格切命令与参数（纯函数，便于单测） */
function parseCommand(raw) {
    const text = (raw !== null && raw !== void 0 ? raw : '')
        .replace(/@_user_\d+/g, ' ')
        .replace(/@\S+\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text)
        return { name: 'unknown' };
    const [head, ...rest] = text.split(' ');
    const arg = rest.join(' ').trim();
    if (/^(帮助|help)$/i.test(head))
        return { name: 'help' };
    if (/^(待处理|看板|board)$/i.test(head))
        return { name: 'board' };
    if (/^(今日汇总|汇总|digest)$/i.test(head))
        return { name: 'digest' };
    if (/^(异常|异常清单|超时|exceptions?)$/i.test(head))
        return { name: 'exceptions' };
    if (/^(查|订单|status)$/i.test(head))
        return { name: 'status', orderCode: arg ? arg.split(' ')[0] : undefined };
    if (/^(关店|暂停营业|暂停)$/.test(head))
        return { name: 'close', store: arg ? arg.split(' ')[0] : undefined };
    if (/^(开店|恢复营业|营业)$/.test(head))
        return { name: 'open', store: arg ? arg.split(' ')[0] : undefined };
    if (/^接单$/.test(head))
        return { name: 'accept', orderCode: arg ? arg.split(' ')[0] : undefined };
    if (/^出餐$/.test(head))
        return { name: 'cooking', orderCode: arg ? arg.split(' ')[0] : undefined };
    if (/^(送达|交接)$/.test(head))
        return { name: 'handover', orderCode: arg ? arg.split(' ')[0] : undefined };
    if (/^(重发交接码|重发码)$/.test(head)) {
        return { name: 'resendHandover', orderCode: arg ? arg.split(' ')[0] : undefined };
    }
    if (/^确认拒单$/.test(head))
        return { name: 'confirmReject', orderCode: arg ? arg.split(' ')[0] : undefined };
    if (/^确认恢复$/.test(head))
        return { name: 'confirmRestore', orderCode: arg ? arg.split(' ')[0] : undefined };
    if (/^拒单$/.test(head)) {
        const [orderCode, ...reasonParts] = arg.split(' ').filter(Boolean);
        return { name: 'reject', orderCode, reason: reasonParts.join(' ').trim() || undefined };
    }
    if (/^(恢复|restore)$/i.test(head))
        return { name: 'restore', orderCode: arg ? arg.split(' ')[0] : undefined };
    return { name: 'unknown' };
}
/** 指令所需权限等级：operator=查询/接单/出餐；owner=拒单/开关店 */
function requiredRole(cmd) {
    switch (cmd) {
        case 'help':
        case 'unknown':
            return 'none';
        case 'reject':
        case 'confirmReject':
        case 'close':
        case 'open':
            return 'owner';
        default:
            return 'operator';
    }
}
/** Bug 9 回归测试入口：confirmRestore 的 UPDATE SQL 纯函数，spec 可直接断言不含幽灵列
 * 历史 bug: 曾硬写 customFieldsExceptionfinal=FLASE——custom-fields.ts 无此定义，恢复功能完全不可用
 * PG 列名必须双引号：本 fork 物理列是 customFields 前缀带大写（customFieldsHallstatus），
 * 裸写会被 PG 折叠成小写 → column does not exist（SQLite 单测不暴露，生产直接报错） */
function buildRestoreSQL() {
    const fields = [
        '"customFieldsHallstatus"=\'open\'',
        '"customFieldsExceptionaction"=NULL',
        '"customFieldsExceptionhandledat"=NULL',
        '"customFieldsExceptionhandledby"=NULL',
        '"customFieldsExceptionhandlednote"=NULL',
    ];
    return {
        sql: `UPDATE "order" SET ${fields.join(', ')} WHERE id=$1`,
        fields,
    };
}
/** audit 日志建表 SQL：CREATE TABLE IF NOT EXISTS 零 migration，首次 audit 时触发 */
exports.AUDIT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS feishu_audit_log (
    id bigserial PRIMARY KEY,
    ts timestamptz NOT NULL DEFAULT now(),
    chat_id text,
    open_id text,
    cmd_name text,
    card_action text,
    order_code text,
    result text
)`;
/**
 * 飞书群指令：解析 → 权限校验 → 调商家工作台服务 → 回复结果。
 * 群定位：
 * - channel：店铺群，看板/汇总/写操作都限定绑定的店铺；
 * - platform：平台管理群，看板/异常/汇总跨全部店铺，写操作按单号/店铺参数指定。
 * 鉴权：chat_id 白名单（FEISHU_CHAT_MAP）+ open_id 分 operators / owners 两级；
 * 所有操作记审计日志，回复里不出现顾客手机号/详细地址。
 */
let FeishuCommandService = class FeishuCommandService {
    constructor(cfg, client, cards, requestContextService, connection, merchant, dispatchAdmin, deliveryStats, hall, riderTask, 
    /** M4 跨实例限流/待确认状态（多实例下同一指令不会在多个进程各自放行）；未注入退回进程内 Map */
    dedupe) {
        this.cfg = cfg;
        this.client = client;
        this.cards = cards;
        this.requestContextService = requestContextService;
        this.connection = connection;
        this.merchant = merchant;
        this.dispatchAdmin = dispatchAdmin;
        this.deliveryStats = deliveryStats;
        this.hall = hall;
        this.riderTask = riderTask;
        this.dedupe = dedupe;
        this.rate = new Map();
        this.pendingReject = new Map();
        this.pendingRestore = new Map();
    }
    async handleMessage(input) {
        var _a, _b;
        const { chatId, openId } = input;
        if (!this.client.enabled)
            return;
        const chat = this.cfg.chatOf(chatId);
        if (!chat) {
            core_1.Logger.warn(`未配置的群 chat_id=${chatId}，忽略指令`, loggerCtx);
            return;
        }
        // 防御性隔离：骑手群只有抢单回调，不接受商家/平台指令（事件层已分流，这里兜底防止误路由）
        if (chat.scope === 'rider') {
            core_1.Logger.warn(`骑手群不接受商家指令 chat=${chatId}，已忽略`, loggerCtx);
            return;
        }
        if (await this.isRateLimited(chatId)) {
            await this.reply(chatId, '操作过于频繁，请稍后再试。');
            return;
        }
        // 引用绑定：被引用的是订单/候选卡片时，自动把完整单号带进本次沟通
        const quotedCode = await this.quotedCodeOf(input.parentId, input.rootId);
        if (quotedCode) {
            const tpl = (0, feishu_templates_1.matchReplyTemplate)(input.text);
            if (tpl) {
                if (!this.isOperator(chat, openId)) {
                    await this.audit(chatId, openId, { name: 'accept', orderCode: quotedCode }, 'denied-template');
                    await this.reply(chatId, '无权限发送模板（需操作员白名单）。');
                    return;
                }
                const ok = await this.replyInThread(chatId, (_a = input.parentId) !== null && _a !== void 0 ? _a : input.rootId, (0, feishu_templates_1.replyTemplateText)(tpl, quotedCode));
                await this.audit(chatId, openId, { name: 'accept', orderCode: quotedCode }, `template:${tpl.id}:${ok ? 'ok' : 'failed'}`);
                return;
            }
        }
        const cmd = parseCommand(input.text);
        if (!cmd.orderCode && quotedCode && cmd.name !== 'unknown' && cmd.name !== 'help') {
            cmd.orderCode = quotedCode;
        }
        const role = requiredRole(cmd.name);
        if (role === 'operator' && !this.isOperator(chat, openId)) {
            await this.audit(chatId, openId, cmd, 'denied');
            await this.reply(chatId, '无权限执行该指令（需操作员白名单）。');
            return;
        }
        if (role === 'owner' && !chat.owners.includes(openId)) {
            await this.audit(chatId, openId, cmd, 'denied-owner');
            await this.reply(chatId, '无权限执行该指令（需管理员白名单）。');
            return;
        }
        try {
            switch (cmd.name) {
                case 'help':
                    await this.reply(chatId, feishu_templates_1.HELP_TEXT);
                    break;
                case 'board':
                    await this.reply(chatId, await this.renderBoard(chat));
                    break;
                case 'digest':
                    await this.reply(chatId, await this.renderDigest(chat));
                    break;
                case 'exceptions':
                    await this.reply(chatId, await this.renderExceptions(chat));
                    break;
                case 'status':
                    await this.status(chat, chatId, cmd);
                    break;
                case 'accept':
                    await this.accept(chat, chatId, openId, cmd);
                    break;
                case 'cooking':
                    await this.cooking(chat, chatId, openId, cmd);
                    break;
                case 'handover':
                    await this.handover(chat, chatId, openId, cmd);
                    break;
                case 'resendHandover':
                    await this.resendHandover(chat, chatId, openId, cmd);
                    break;
                case 'reject':
                    await this.stageReject(chat, chatId, openId, cmd);
                    break;
                case 'confirmReject':
                    await this.confirmReject(chat, chatId, openId, cmd);
                    break;
                case 'confirmRestore':
                    await this.confirmRestore(chat, chatId, openId, cmd);
                    break;
                case 'close':
                case 'open':
                    await this.setPaused(chat, chatId, openId, cmd.name === 'close', cmd.store);
                    break;
                case 'restore':
                    await this.stageRestore(chat, chatId, openId, cmd);
                    break;
                default: {
                    const tpl = (0, feishu_templates_1.matchReplyTemplate)(input.text);
                    await this.reply(chatId, tpl
                        ? `「${tpl.label}」需先引用订单卡片（或先「查 <尾号>」），再回复或点击模板。`
                        : '未识别指令，发送「帮助」查看可用指令。');
                }
            }
        }
        catch (e) {
            const msg = (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(e);
            await this.audit(chatId, openId, cmd, `error:${msg}`);
            await this.reply(chatId, `执行失败：${msg}`);
        }
    }
    /** 卡片按钮回调（card.action.trigger）：全部走同一条通道，不落库 */
    async handleCardAction(input) {
        var _a, _b, _c, _d;
        const { chatId, openId, messageId } = input;
        if (!this.client.enabled)
            return;
        const chat = this.cfg.chatOf(chatId);
        if (!chat) {
            core_1.Logger.warn(`未配置的群 chat_id=${chatId}，忽略卡片操作`, loggerCtx);
            return;
        }
        // 防御性隔离：骑手群卡片只走抢单服务，商家卡片动作不得在骑手群执行
        if (chat.scope === 'rider') {
            core_1.Logger.warn(`骑手群不接受商家卡片操作 chat=${chatId}，已忽略`, loggerCtx);
            return;
        }
        const action = String((_b = (_a = input.value) === null || _a === void 0 ? void 0 : _a.a) !== null && _b !== void 0 ? _b : '');
        const code = typeof ((_c = input.value) === null || _c === void 0 ? void 0 : _c.c) === 'string' ? input.value.c : undefined;
        const known = ['accept', 'cooking', 'status', 'view', 'template', 'tpl', 'reassign', 'handled', 'refund_diff', 'coupon', 'refund_all'];
        if (!known.includes(action))
            return;
        const cmd = {
            name: action === 'accept' ? 'accept' : action === 'cooking' ? 'cooking' : 'status',
            orderCode: code,
            cardAction: action,
        };
        // 卡片回调与文本指令共用同一限流器（防脚本连点/误触连发）
        if (await this.isRateLimited(chatId)) {
            await this.audit(chatId, openId, cmd, 'rate-limited-card');
            await this.reply(chatId, '操作过于频繁，请稍后再试。');
            return;
        }
        if (!this.isOperator(chat, openId)) {
            await this.audit(chatId, openId, cmd, 'denied-card');
            await this.reply(chatId, '无权限操作（需操作员白名单）。');
            return;
        }
        if (!code) {
            await this.reply(chatId, '卡片缺少订单信息，请重新发送「查 <尾号>」。');
            return;
        }
        try {
            switch (action) {
                case 'accept': {
                    const found = await this.requireOrder(chat, chatId, code);
                    if (!found)
                        return;
                    await this.merchant.acceptOrder(found.ctx, found.order.id);
                    await this.audit(chatId, openId, cmd, 'ok-card');
                    if (!(await this.cards.refresh(messageId, code))) {
                        await this.reply(chatId, `已接单：${found.order.code}`);
                    }
                    break;
                }
                case 'cooking': {
                    const found = await this.requireOrder(chat, chatId, code);
                    if (!found)
                        return;
                    await this.merchant.cookingDone(found.ctx, found.order.id);
                    await this.audit(chatId, openId, cmd, 'ok-card');
                    if (!(await this.cards.refresh(messageId, code))) {
                        await this.reply(chatId, `已出餐：${found.order.code}`);
                    }
                    break;
                }
                case 'exception':
                case 'status':
                case 'view': {
                    // 读操作同样必须校验归属：店铺群只能看本店订单，避免跨店读取详情/异常备注
                    const found = await this.requireOrder(chat, chatId, code);
                    if (!found)
                        return;
                    await this.replyInThread(chatId, messageId, await this.statusText(code));
                    break;
                }
                case 'template': {
                    const card = (0, feishu_templates_1.buildTemplateCard)(code);
                    const inThread = messageId ? await this.client.replyCard(messageId, card, true) : false;
                    if (!inThread)
                        await this.client.sendCard(chatId, card);
                    break;
                }
                case 'tpl': {
                    const tpl = feishu_templates_1.REPLY_TEMPLATES.find(t => { var _a, _b; return t.id === String((_b = (_a = input.value) === null || _a === void 0 ? void 0 : _a.t) !== null && _b !== void 0 ? _b : ''); });
                    if (!tpl)
                        return;
                    await this.replyInThread(chatId, messageId, (0, feishu_templates_1.replyTemplateText)(tpl, code));
                    break;
                }
                case 'reassign': {
                    const found = await this.requireOrder(chat, chatId, code);
                    if (!found)
                        return;
                    await this.dispatchAdmin.handleException(found.ctx, found.order.id, 'reassign');
                    await this.audit(chatId, openId, { name: 'reassign', orderCode: code }, 'ok-card');
                    // Bug 10 修复：改派后 hallStatus→open，之前的异常告警行清掉避免视觉残留
                    this.cards.clearAlerts(code);
                    if (!(await this.cards.refresh(messageId, code))) {
                        await this.reply(chatId, `已改派：${code}（异常单已回抢单大厅）`);
                    }
                    break;
                }
                case 'handled': {
                    const found = await this.requireOrder(chat, chatId, code);
                    if (!found)
                        return;
                    await this.dispatchAdmin.handleException(found.ctx, found.order.id, 'handled');
                    await this.audit(chatId, openId, { name: 'handled', orderCode: code }, 'ok-card');
                    // Bug 10 修复：handled 后 hallStatus→exception_final，告警历史清掉
                    this.cards.clearAlerts(code);
                    if (!(await this.cards.refresh(messageId, code))) {
                        await this.reply(chatId, `已标记处置完结：${code}`);
                    }
                    break;
                }
                case 'refund_diff':
                case 'coupon':
                case 'refund_all': {
                    // 资金动作（退差价/发补偿券/全额退款）要求店主，普通操作员只能处理履约类操作
                    if (!this.isOwner(chat, openId)) {
                        await this.audit(chatId, openId, cmd, 'denied-card');
                        await this.reply(chatId, '无权限操作（资金操作需店主）。');
                        return;
                    }
                    const found = await this.requireOrder(chat, chatId, code);
                    if (!found)
                        return;
                    const actionName = action;
                    const label = actionName === 'refund_diff' ? '退差价' : actionName === 'coupon' ? '发补偿券' : '全额退款';
                    await this.dispatchAdmin.handleException(found.ctx, found.order.id, actionName);
                    await this.audit(chatId, openId, { name: 'status', orderCode: code, cardAction: actionName }, `ok-card:${actionName}`);
                    // Bug 10 修复：退款/发券后 hallStatus→exception_final，告警历史清掉
                    this.cards.clearAlerts(code);
                    if (!(await this.cards.refresh(messageId, code))) {
                        await this.reply(chatId, `${label}已执行：${code}`);
                    }
                    break;
                }
            }
        }
        catch (e) {
            const msg = (_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : String(e);
            await this.audit(chatId, openId, cmd, `error:${msg}`);
            await this.reply(chatId, `执行失败：${msg}`);
        }
    }
    // ---------- 视图 ----------
    async renderBoard(chat) {
        if (chat.scope === 'platform')
            return this.platformBoardText();
        return this.channelBoardText(chat.channel, false);
    }
    async renderDigest(chat) {
        if (chat.scope === 'platform')
            return this.platformDigestText();
        return this.channelBoardText(chat.channel, true);
    }
    async renderExceptions(chat) {
        const targets = chat.scope === 'platform'
            ? await this.channelTargets()
            : [{ token: chat.channel, name: chat.channel }];
        const { exceptions, overdue, soonOverdue } = await this.collectIssues(targets);
        return (0, feishu_templates_1.formatExceptions)(exceptions, overdue, soonOverdue);
    }
    async platformBoardText() {
        const targets = await this.channelTargets();
        if (!targets.length)
            return '暂无已开通外卖的店铺。';
        const { exceptions, overdue, soonOverdue } = await this.collectIssues(targets);
        const stores = [];
        for (const t of targets) {
            const ctx = await this.ctxForToken(t.token);
            const board = await this.merchant.board(ctx);
            stores.push({
                name: board.storeName || t.name,
                paused: board.paused,
                pending: board.pending.length,
                pendingCodes: board.pending.slice(0, 3).map(o => o.code),
                cooking: board.cooking.length,
                awaitingRider: board.awaitingRider.length,
                delivering: board.delivering.length,
                pendingDispatch: board.pendingDispatch.length,
                thirdParty: board.thirdParty.length,
                ownedPool: board.ownedPool.length,
                ownedDispatched: board.ownedDispatched.length,
                merchantDelivering: board.merchantDelivering.length,
                completedToday: board.completedToday,
                completedTodayAmount: board.completedTodayAmount,
                exceptionCount: exceptions.filter(t2 => t2.startsWith(`${t.name} `)).length,
            });
        }
        return (0, feishu_templates_1.formatPlatformBoard)({ stores, exceptions, overdue, at: Date.now() });
    }
    async platformDigestText() {
        const targets = await this.channelTargets();
        if (!targets.length)
            return '暂无已开通外卖的店铺。';
        const rows = [];
        let totalOrders = 0;
        let cancelled = 0;
        let completed = 0;
        let amount = 0;
        let exception = 0;
        let weighted = 0;
        let weight = 0;
        for (const t of targets) {
            const ctx = await this.ctxForToken(t.token);
            const board = await this.merchant.board(ctx);
            const stats = await this.deliveryStats.stats(ctx, 'today');
            const cancelledCount = await this.cancelledCount(ctx);
            const exceptionCount = await this.exceptionCount(ctx);
            rows.push({
                name: board.storeName || t.name,
                completed: board.completedToday,
                amount: board.completedTodayAmount,
                onTimeRate: stats.kpis.onTimeRate,
                cancelled: cancelledCount,
                exception: exceptionCount,
            });
            totalOrders += stats.kpis.totalOrders;
            cancelled += cancelledCount;
            completed += board.completedToday;
            amount += board.completedTodayAmount;
            exception += exceptionCount;
            weighted += stats.kpis.onTimeRate * stats.kpis.totalOrders;
            weight += stats.kpis.totalOrders;
        }
        return (0, feishu_templates_1.formatPlatformDigest)({
            date: (0, campus_time_1.campusDayKey)(Date.now()),
            stores: rows,
            totalOrders,
            cancelled,
            completed,
            amount,
            onTimeRate: weight ? Math.round(weighted / weight) : 0,
            exception,
        });
    }
    async channelBoardText(channelToken, withDigest) {
        const ctx = await this.ctxForToken(channelToken);
        const board = await this.merchant.board(ctx);
        if (!withDigest)
            return (0, feishu_templates_1.formatBoard)(board);
        const stats = await this.deliveryStats.stats(ctx, 'today');
        return (0, feishu_templates_1.formatDigest)(Object.assign(Object.assign({}, board), { date: (0, campus_time_1.campusDayKey)(Date.now()), totalOrders: stats.kpis.totalOrders, onTimeRate: stats.kpis.onTimeRate, cancelled: await this.cancelledCount(ctx), exceptionCount: await this.exceptionCount(ctx) }));
    }
    // ---------- 查单：精确 + 模糊（只读现有 order 表） ----------
    async status(chat, chatId, cmd) {
        if (!cmd.orderCode) {
            await this.reply(chatId, '用法：查 <尾号/楼栋/单号>，例如「查 1234」「查 3 栋」。');
            return;
        }
        const exact = await this.findExactOrder(chat, cmd.orderCode);
        if (exact) {
            if (!(await this.cards.sendOrderCard(chatId, exact.code))) {
                await this.reply(chatId, await this.statusText(exact.code));
            }
            return;
        }
        const rows = await this.searchOrders(chat, cmd.orderCode);
        if (!rows.length) {
            await this.reply(chatId, `未找到与「${cmd.orderCode}」匹配的今日订单。`);
            return;
        }
        if (rows.length === 1) {
            if (!(await this.cards.sendOrderCard(chatId, rows[0].code))) {
                await this.reply(chatId, await this.statusText(rows[0].code));
            }
            return;
        }
        await this.client.sendCard(chatId, (0, feishu_templates_1.buildSearchCard)(cmd.orderCode, rows));
    }
    async statusText(code) {
        const view = await this.cards.loadOrderView(code);
        return view ? (0, feishu_templates_1.formatOrderStatus)(view) : `未找到订单：${code}`;
    }
    async findExactOrder(chat, code) {
        var _a;
        const order = await this.connection.rawConnection.getRepository(core_1.Order).findOne({
            where: { code },
            relations: ['channels'],
        });
        if (!order)
            return null;
        if (chat.scope === 'platform')
            return order;
        return ((_a = order.channels) === null || _a === void 0 ? void 0 : _a.some(c => c.token === chat.channel)) ? order : null;
    }
    /** 模糊检索：近 7 天订单按完整单号/尾号/楼栋匹配（最多 5 条），纯读、不建索引 */
    async searchOrders(chat, query) {
        var _a, _b, _c, _d, _e, _f, _g;
        const needle = (query !== null && query !== void 0 ? query : '').trim();
        if (!needle)
            return [];
        const since = new Date(Date.now() - 7 * 24 * 3600000);
        const qb = this.connection.rawConnection.getRepository(core_1.Order).createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .where('order.createdAt >= :start', { start: since })
            .orderBy('order.createdAt', 'DESC')
            .take(200);
        if (chat.scope !== 'platform' && chat.channel) {
            qb.andWhere('channel.token = :token', { token: chat.channel });
        }
        const orders = await qb.getMany();
        const buildingIds = [...new Set(orders.map(o => { var _a; return (_a = o.customFields) === null || _a === void 0 ? void 0 : _a.buildingId; }).filter(Boolean).map(String))];
        const buildings = buildingIds.length
            ? await this.connection.rawConnection.getRepository(campus_building_entity_1.CampusBuilding).find({
                where: { id: (0, typeorm_1.In)(buildingIds) },
            })
            : [];
        const nameById = new Map(buildings.map(b => [String(b.id), b.name]));
        const upper = needle.toUpperCase();
        const rows = [];
        for (const o of orders) {
            const cf = o.customFields;
            const building = (_b = nameById.get(String((_a = cf === null || cf === void 0 ? void 0 : cf.buildingId) !== null && _a !== void 0 ? _a : ''))) !== null && _b !== void 0 ? _b : null;
            const hit = o.code.toUpperCase().includes(upper) || (building ? building.includes(needle) : false);
            if (!hit)
                continue;
            rows.push({
                code: o.code,
                store: (_f = (_e = (_d = (_c = o.channels) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.code) !== null && _e !== void 0 ? _e : chat.channel) !== null && _f !== void 0 ? _f : '',
                hallStatus: (_g = cf === null || cf === void 0 ? void 0 : cf.hallStatus) !== null && _g !== void 0 ? _g : null,
                building,
                createdAt: new Date(o.createdAt).getTime(),
            });
            if (rows.length >= 5)
                break;
        }
        return rows;
    }
    /** 允许用尾号/楼栋操作：唯一命中才放行，多命中发候选卡片 */
    async resolveOrderCode(chat, chatId, input) {
        if (!input)
            return null;
        const exact = await this.findExactOrder(chat, input);
        if (exact)
            return exact.code;
        const rows = await this.searchOrders(chat, input);
        if (rows.length === 1)
            return rows[0].code;
        if (!rows.length) {
            await this.reply(chatId, `未找到与「${input}」匹配的订单。`);
            return null;
        }
        await this.client.sendCard(chatId, (0, feishu_templates_1.buildSearchCard)(input, rows));
        return null;
    }
    /** 引用消息 → 完整单号（卡片读按钮 value，文本读最长字母数字串） */
    async quotedCodeOf(parentId, rootId) {
        if (!parentId && !rootId)
            return undefined;
        const direct = parentId ? await this.codeFromMessage(parentId) : undefined;
        if (direct)
            return direct;
        if (rootId && rootId !== parentId)
            return this.codeFromMessage(rootId);
        return undefined;
    }
    async codeFromMessage(messageId) {
        var _a;
        const msg = await this.client.getMessage(messageId);
        if (!msg)
            return undefined;
        const content = (_a = msg.body) === null || _a === void 0 ? void 0 : _a.content;
        const fromCard = (0, feishu_templates_1.extractOrderCodeFromCard)(content);
        if (fromCard)
            return fromCard;
        let text;
        try {
            const parsed = JSON.parse(content !== null && content !== void 0 ? content : '');
            text = typeof (parsed === null || parsed === void 0 ? void 0 : parsed.text) === 'string' ? parsed.text : undefined;
        }
        catch (_b) {
            text = undefined;
        }
        const candidate = (0, feishu_templates_1.extractOrderCodeFromText)(text);
        if (!candidate)
            return undefined;
        // 文本兜底必须命中真实订单，避免把普通长串误当成单号
        const exists = await this.connection.rawConnection.getRepository(core_1.Order).findOne({ where: { code: candidate } });
        return exists === null || exists === void 0 ? void 0 : exists.code;
    }
    // ---------- 异常/超时清单 ----------
    async collectIssues(targets) {
        const exceptions = [];
        const overdue = [];
        const soonOverdue = [];
        for (const t of targets) {
            const ctx = await this.ctxForToken(t.token);
            const cfg = await this.connection.getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig).findOne({
                where: { channelId: ctx.channelId },
            });
            if (!cfg)
                continue;
            const orders = await this.connection.getRepository(ctx, core_1.Order).createQueryBuilder('order')
                .leftJoin('order.channels', 'channel')
                .where('channel.id = :ch', { ch: ctx.channelId })
                .andWhere('order.state != :cancelled', { cancelled: 'Cancelled' })
                .andWhere('order.customFields.hallStatus IS NOT NULL')
                .getMany();
            const now = Date.now();
            for (const o of orders) {
                const cf = o.customFields;
                if (cf.deliveryStatus === 'exception') {
                    const at = cf.exceptionReportedAt ? new Date(cf.exceptionReportedAt).getTime() : NaN;
                    const mins = Number.isNaN(at) ? null : Math.round((now - at) / 60000);
                    const detail = [cf.exceptionType, cf.exceptionNote].filter(Boolean).join('｜') || '异常未处置';
                    exceptions.push(`${o.code} ${t.name} ${detail}${mins != null ? `（已 ${mins} 分钟）` : ''}`);
                    continue;
                }
                const entry = this.overdueOf(o, cf, cfg, now);
                if (entry)
                    overdue.push(`${o.code} ${t.name} ${entry}`);
                else {
                    const soon = this.soonOverdueOf(o, cf, cfg, now);
                    if (soon)
                        soonOverdue.push(`${o.code} ${t.name} ${soon}`);
                }
            }
        }
        return { exceptions, overdue, soonOverdue };
    }
    /** 即将超时（提前告警窗口内但还没真超阈值） */
    soonOverdueOf(order, cf, cfg, now) {
        var _a, _b, _c, _d;
        const minutesSince = (t) => t ? Math.round((now - new Date(t).getTime()) / 60000) : null;
        const accept = (_a = cfg.merchantAcceptMinutes) !== null && _a !== void 0 ? _a : 5;
        const push = (_b = cfg.externalPushTimeoutMinutes) !== null && _b !== void 0 ? _b : 10;
        const fallback = (_c = cfg.externalFallbackMinutes) !== null && _c !== void 0 ? _c : 20;
        const NOT_PICKED = 15;
        switch (cf.hallStatus) {
            case 'pending_merchant': {
                const m = minutesSince((_d = cf.hallEnteredAt) !== null && _d !== void 0 ? _d : order.createdAt);
                const alertStart = accept - feishu_alert_windows_1.ALERT_WINDOWS_MIN.accept;
                if (m != null && m >= alertStart && m <= accept)
                    return `⚠️ 商户即将超时（${m}/${accept}min）`;
                return null;
            }
            case 'grabbed':
            case 'assigned': {
                const m = minutesSince(cf.assignedAt);
                const alertStart = NOT_PICKED - feishu_alert_windows_1.ALERT_WINDOWS_MIN.riderPick;
                if (m != null && m >= alertStart && m <= NOT_PICKED)
                    return `⚠️ 骑手即将超时（${m}/${NOT_PICKED}min）`;
                return null;
            }
            case 'third_party': {
                const m = minutesSince(cf.thirdPartyDispatchAt);
                const alertStart = fallback - feishu_alert_windows_1.ALERT_WINDOWS_MIN.thirdParty;
                if (m != null && m >= alertStart && m <= fallback)
                    return `⚠️ 外部快递即将超时（${m}/${fallback}min）`;
                return null;
            }
            default:
                return null;
        }
    }
    /** 各环节超时判定（与调度兜底阈值保持一致，仅用于群里提示，不做任何改单） */
    overdueOf(order, cf, cfg, now) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const minutesSince = (t) => t ? Math.round((now - new Date(t).getTime()) / 60000) : null;
        const exceeded = (m, threshold) => m != null && m > threshold;
        const accept = (_a = cfg.merchantAcceptMinutes) !== null && _a !== void 0 ? _a : 5;
        const auto = (_b = cfg.merchantAutoOpenMinutes) !== null && _b !== void 0 ? _b : 15;
        const push = (_c = cfg.externalPushTimeoutMinutes) !== null && _c !== void 0 ? _c : 10;
        const fallback = (_d = cfg.externalFallbackMinutes) !== null && _d !== void 0 ? _d : 20;
        switch (cf.hallStatus) {
            case 'pending_merchant': {
                const m = minutesSince((_e = cf.hallEnteredAt) !== null && _e !== void 0 ? _e : order.createdAt);
                return exceeded(m, accept) ? `商户 ${m} 分钟未接单（阈值 ${accept}）` : null;
            }
            case 'accepted': {
                const m = minutesSince((_f = cf.hallEnteredAt) !== null && _f !== void 0 ? _f : order.createdAt);
                return exceeded(m, auto) ? `商户 ${m} 分钟未出餐（阈值 ${auto}）` : null;
            }
            case 'open': {
                const m = minutesSince((_g = cf.hallEnteredAt) !== null && _g !== void 0 ? _g : order.createdAt);
                return exceeded(m, auto) ? `待抢单 ${m} 分钟无人接（阈值 ${auto}）` : null;
            }
            case 'grabbed': {
                const m = minutesSince(cf.assignedAt);
                return exceeded(m, RIDER_PICK_TIMEOUT_MIN) ? `骑手 ${m} 分钟未取货（阈值 ${RIDER_PICK_TIMEOUT_MIN}）` : null;
            }
            case 'pending_dispatch': {
                const m = minutesSince((_k = (_j = (_h = cf.assignedAt) !== null && _h !== void 0 ? _h : cf.thirdPartyDispatchAt) !== null && _j !== void 0 ? _j : cf.hallEnteredAt) !== null && _k !== void 0 ? _k : order.createdAt);
                return exceeded(m, push) ? `待推外部 ${m} 分钟（阈值 ${push}）` : null;
            }
            case 'third_party': {
                const m = minutesSince(cf.thirdPartyDispatchAt);
                return exceeded(m, fallback) ? `外部快递 ${m} 分钟未接单/取货（阈值 ${fallback}）` : null;
            }
            case 'owned_pool': {
                const m = minutesSince((_l = cf.hallEnteredAt) !== null && _l !== void 0 ? _l : order.createdAt);
                return exceeded(m, auto) ? `自营池 ${m} 分钟无人接（阈值 ${auto}）` : null;
            }
            case 'owned_dispatched':
            case 'merchant_delivering': {
                const m = minutesSince(cf.assignedAt);
                return exceeded(m, auto) ? `配送 ${m} 分钟未到交接点（阈值 ${auto}）` : null;
            }
            default:
                return null;
        }
    }
    // ---------- 写操作 ----------
    async accept(chat, chatId, openId, cmd) {
        if (!cmd.orderCode) {
            await this.reply(chatId, '请带单号，例如「接单 A1234」或直接点卡片按钮。');
            return;
        }
        const code = await this.resolveOrderCode(chat, chatId, cmd.orderCode);
        if (!code)
            return;
        const found = await this.requireOrder(chat, chatId, code);
        if (!found)
            return;
        await this.merchant.acceptOrder(found.ctx, found.order.id);
        await this.audit(chatId, openId, Object.assign(Object.assign({}, cmd), { orderCode: code }), 'ok');
        await this.reply(chatId, `已接单：${found.order.code}`);
    }
    async cooking(chat, chatId, openId, cmd) {
        if (!cmd.orderCode) {
            await this.reply(chatId, '请带单号，例如「出餐 A1234」或直接点卡片按钮。');
            return;
        }
        const code = await this.resolveOrderCode(chat, chatId, cmd.orderCode);
        if (!code)
            return;
        const found = await this.requireOrder(chat, chatId, code);
        if (!found)
            return;
        await this.merchant.cookingDone(found.ctx, found.order.id);
        await this.audit(chatId, openId, Object.assign(Object.assign({}, cmd), { orderCode: code }), 'ok');
        await this.reply(chatId, `已出餐：${found.order.code}`);
    }
    /** R1 商户/自营快递送达校园交接点：按当前履约阶段分流（无需商户进后台点按钮） */
    async handover(chat, chatId, openId, cmd) {
        var _a, _b;
        if (!cmd.orderCode) {
            await this.reply(chatId, '请带单号，例如「送达 A1234」。');
            return;
        }
        const code = await this.resolveOrderCode(chat, chatId, cmd.orderCode);
        if (!code)
            return;
        const found = await this.requireOrder(chat, chatId, code);
        if (!found)
            return;
        const status = String((_b = (_a = found.order.customFields) === null || _a === void 0 ? void 0 : _a.hallStatus) !== null && _b !== void 0 ? _b : '');
        if (status === 'merchant_delivering') {
            await this.merchant.markHandoverArrived(found.ctx, found.order.id);
        }
        else if (status === 'owned_dispatched') {
            await this.merchant.markOwnedArrived(found.ctx, found.order.id);
        }
        else {
            await this.reply(chatId, `订单 ${found.order.code} 当前状态（${status || '未知'}）不能确认送达交接点。`);
            return;
        }
        await this.audit(chatId, openId, Object.assign(Object.assign({}, cmd), { orderCode: code }), 'ok');
        await this.reply(chatId, `已确认送达校园交接点：${found.order.code}`);
    }
    /** R5 交接码重发：仅待交接（hallStatus=open）订单可重发；同单 10 分钟限流。 */
    async resendHandover(chat, chatId, openId, cmd) {
        if (!cmd.orderCode) {
            await this.reply(chatId, '请带单号，例如「重发交接码 A1234」。');
            return;
        }
        const code = await this.resolveOrderCode(chat, chatId, cmd.orderCode);
        if (!code)
            return;
        const found = await this.requireOrder(chat, chatId, code);
        if (!found)
            return;
        const newCode = await this.hall.resendHandoverCode(found.ctx, Number(found.order.id));
        await this.riderTask.resetHandoverGuard(found.order.id);
        await this.audit(chatId, openId, Object.assign(Object.assign({}, cmd), { orderCode: code }), 'ok');
        await this.reply(chatId, `已重发交接码：${found.order.code} → ${newCode}（10 分钟内有效，请告知交接点）`);
    }
    /** 拒单第一步：只登记待确认，不执行任何退款/取消 */
    async stageReject(chat, chatId, openId, cmd) {
        if (!cmd.orderCode) {
            await this.reply(chatId, '用法：拒单 <单号> <原因>');
            return;
        }
        const code = await this.resolveOrderCode(chat, chatId, cmd.orderCode);
        if (!code)
            return;
        this.cleanupConfirmations();
        const pending = { reason: cmd.reason, openId, at: Date.now() };
        if (this.dedupe) {
            await this.dedupe.setJson(`feishu:pending_reject:${chatId}:${code}`, pending, CONFIRM_TTL_MS);
        }
        else {
            this.pendingReject.set(`${chatId}:${code}`, pending);
        }
        await this.reply(chatId, `即将拒单 ${code}（全额退款并取消订单）。确认请回复「确认拒单 ${code}」。`);
    }
    async confirmReject(chat, chatId, openId, cmd) {
        var _a;
        if (!cmd.orderCode) {
            await this.reply(chatId, '用法：确认拒单 <单号>');
            return;
        }
        const code = await this.resolveOrderCode(chat, chatId, cmd.orderCode);
        if (!code)
            return;
        this.cleanupConfirmations();
        const storeKey = `feishu:pending_reject:${chatId}:${code}`;
        const pending = this.dedupe
            ? await this.dedupe.getJson(storeKey)
            : this.pendingReject.get(`${chatId}:${code}`);
        if (!pending || pending.openId !== openId) {
            await this.reply(chatId, '确认已过期，请重新发送「拒单 <单号> <原因>」。');
            return;
        }
        if (this.dedupe)
            await this.dedupe.del(storeKey);
        else
            this.pendingReject.delete(`${chatId}:${code}`);
        const found = await this.requireOrder(chat, chatId, code);
        if (!found)
            return;
        await this.merchant.rejectOrder(found.ctx, found.order.id, pending.reason || '飞书指令拒单');
        await this.audit(chatId, openId, Object.assign(Object.assign({}, cmd), { orderCode: code }), `ok reason=${(_a = pending.reason) !== null && _a !== void 0 ? _a : ''}`);
        await this.reply(chatId, `已拒单并退款：${found.order.code}`);
    }
    /** stageRestore：二次确认模式，避免误操作恢复 exception_final 单 */
    async stageRestore(chat, chatId, openId, cmd) {
        if (!cmd.orderCode) {
            await this.reply(chatId, '请带单号，例如「恢复 A1234」。');
            return;
        }
        const code = await this.resolveOrderCode(chat, chatId, cmd.orderCode);
        if (!code)
            return;
        this.cleanupConfirmations();
        const pending = { openId, at: Date.now() };
        if (this.dedupe) {
            await this.dedupe.setJson(`feishu:pending_restore:${chatId}:${code}`, pending, CONFIRM_TTL_MS);
        }
        else {
            this.pendingRestore.set(`${chatId}:${code}`, pending);
        }
        await this.reply(chatId, `⚠️ 即将恢复 ${code}（hallStatus→open，重新进调度队）。确认请回复「确认恢复 ${code}」，5 分钟内有效。`);
    }
    async confirmRestore(chat, chatId, openId, cmd) {
        var _a;
        if (!cmd.orderCode) {
            await this.reply(chatId, '用法：确认恢复 <单号>');
            return;
        }
        const code = await this.resolveOrderCode(chat, chatId, cmd.orderCode);
        if (!code)
            return;
        this.cleanupConfirmations();
        const storeKey = `feishu:pending_restore:${chatId}:${code}`;
        const pending = this.dedupe
            ? await this.dedupe.getJson(storeKey)
            : this.pendingRestore.get(`${chatId}:${code}`);
        if (!pending || pending.openId !== openId) {
            await this.reply(chatId, '确认已过期，请重新发送「恢复 <单号>」。');
            return;
        }
        if (this.dedupe)
            await this.dedupe.del(storeKey);
        else
            this.pendingRestore.delete(`${chatId}:${code}`);
        const found = await this.requireOrder(chat, chatId, code);
        if (!found)
            return;
        try {
            // Bug 9 修复：之前硬写了不存在的列 customFieldsExceptionfinal，SQL 提取成纯函数便于 spec 回归测试
            const { sql } = buildRestoreSQL();
            await this.connection.rawConnection.query(sql, [found.order.id]);
            // Bug 10 修复：异常已处置/恢复后清掉卡片告警历史，重建卡片时不会再显示已过期的告警行
            this.cards.clearAlerts(code);
            await this.audit(chatId, openId, { name: 'restore', orderCode: code }, 'ok');
            await this.reply(chatId, `已恢复进大厅：${found.order.code}（hallStatus→open）`);
        }
        catch (e) {
            await this.reply(chatId, `恢复失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    async setPaused(chat, chatId, openId, paused, store) {
        let token = chat.channel;
        if (chat.scope === 'platform') {
            const targets = await this.channelTargets();
            const target = store ? targets.find(t => t.name === store || t.token === store) : undefined;
            if (!target) {
                await this.reply(chatId, `请指定店铺，例如「${paused ? '关店' : '开店'} canteen-a」。当前店铺：${targets.map(t => t.name).join('、') || '无'}`);
                return;
            }
            token = target.token;
        }
        if (!token) {
            await this.reply(chatId, '该群未绑定店铺，无法执行开关店。');
            return;
        }
        const ctx = await this.ctxForToken(token);
        await this.merchant.setPaused(ctx, paused);
        await this.audit(chatId, openId, { name: paused ? 'close' : 'open' }, `ok store=${store !== null && store !== void 0 ? store : token}`);
        await this.reply(chatId, paused ? `已暂停营业：${store !== null && store !== void 0 ? store : token}` : `已恢复营业：${store !== null && store !== void 0 ? store : token}`);
    }
    // ---------- 工具 ----------
    async requireOrder(chat, chatId, code) {
        var _a;
        if (!code) {
            await this.reply(chatId, '请带单号，例如「接单 A1234」。');
            return null;
        }
        const order = await this.connection.rawConnection.getRepository(core_1.Order).findOne({
            where: { code },
            relations: ['channels'],
        });
        if (!order) {
            await this.reply(chatId, `未找到订单：${code}`);
            return null;
        }
        const channels = (_a = order.channels) !== null && _a !== void 0 ? _a : [];
        let channel;
        if (chat.scope === 'platform') {
            // 平台群不绑定店铺：单渠道订单可直接确定；多渠道时取 channels[0] 可能写错店，直接拒绝
            if (channels.length > 1) {
                await this.reply(chatId, `订单 ${code} 属于多个店铺，请在对应店铺群操作。`);
                return null;
            }
            channel = channels[0];
        }
        else {
            channel = channels.find(c => c.token === chat.channel);
        }
        if (!channel) {
            await this.reply(chatId, chat.scope === 'platform' ? `订单 ${code} 未绑定店铺` : `未找到本店订单：${code}`);
            return null;
        }
        return { order, ctx: await this.ctxForToken(channel.token) };
    }
    async channelTargets() {
        const cfgs = await this.connection.rawConnection.getRepository(campus_fulfillment_config_entity_1.CampusFulfillmentConfig).find();
        const ids = [...new Set(cfgs.map(c => Number(c.channelId)).filter(id => id > 0))];
        if (!ids.length)
            return [];
        const channels = await this.connection.rawConnection.getRepository(core_1.Channel).find({
            where: { id: (0, typeorm_1.In)(ids) },
        });
        return channels.map(c => ({ token: c.token, name: c.code }));
    }
    ctxForToken(token) {
        return this.requestContextService.create({ apiType: 'admin', channelOrToken: token });
    }
    async cancelledCount(ctx) {
        return this.connection.getRepository(ctx, core_1.Order).createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere('order.state = :st', { st: 'Cancelled' })
            .andWhere('order.createdAt >= :start', { start: new Date((0, campus_time_1.startOfCampusDay)(Date.now())) })
            .getCount();
    }
    async exceptionCount(ctx) {
        return this.connection.getRepository(ctx, core_1.Order).createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere("order.customFields.deliveryStatus = 'exception'")
            .getCount();
    }
    isOperator(chat, openId) {
        return chat.operators.includes(openId) || chat.owners.includes(openId);
    }
    isOwner(chat, openId) {
        return chat.owners.includes(openId);
    }
    async isRateLimited(chatId) {
        var _a;
        if (this.dedupe) {
            return (await this.dedupe.incr(`feishu:rate:${chatId}`, 60000)) > RATE_LIMIT_PER_MIN;
        }
        const now = Date.now();
        const arr = ((_a = this.rate.get(chatId)) !== null && _a !== void 0 ? _a : []).filter(t => now - t < 60000);
        arr.push(now);
        this.rate.set(chatId, arr);
        return arr.length > RATE_LIMIT_PER_MIN;
    }
    /** 安全 GC：数组收集 key + 遍历完统一 delete（避免 Bug 5 模式——遍历时 delete 跳元素） */
    cleanupConfirmations() {
        // dedupe 后端由 TTL 自动过期，无需遍历清理
        if (this.dedupe)
            return;
        const now = Date.now();
        const expiredReject = [];
        for (const [k, v] of this.pendingReject)
            if (now - v.at > CONFIRM_TTL_MS)
                expiredReject.push(k);
        for (const k of expiredReject)
            this.pendingReject.delete(k);
        const expiredRestore = [];
        for (const [k, v] of this.pendingRestore)
            if (now - v.at > CONFIRM_TTL_MS)
                expiredRestore.push(k);
        for (const k of expiredRestore)
            this.pendingRestore.delete(k);
    }
    async reply(chatId, text) {
        await this.client.sendToChat(chatId, text);
    }
    /** 优先回在订单话题里（引用卡片/线程），拿不到锚点消息时退回群消息 */
    async replyInThread(chatId, anchorId, text) {
        var _a;
        if (anchorId) {
            try {
                if (await this.client.replyToMessage(anchorId, text, true))
                    return true;
            }
            catch (e) {
                core_1.Logger.warn(`飞书线程回复失败 anchor=${anchorId}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx);
            }
        }
        return this.client.sendToChat(chatId, text);
    }
    async audit(chatId, openId, cmd, result) {
        var _a, _b, _c;
        const act = cmd.cardAction ? ` card=${cmd.cardAction}` : '';
        const line = `[FeishuAudit] chat=${chatId} open_id=${openId} cmd=${cmd.name}${act} order=${(_a = cmd.orderCode) !== null && _a !== void 0 ? _a : '-'} result=${result}`;
        core_1.Logger.info(line, loggerCtx);
        // P1: audit 日志落库——零建表（CREATE TABLE IF NOT EXISTS），fire-and-forget 不阻塞指令主流程
        try {
            if (!this.auditReady) {
                this.auditReady = this.connection.rawConnection
                    .query(exports.AUDIT_TABLE_SQL)
                    .then(() => undefined)
                    .catch(e => {
                    var _a;
                    core_1.Logger.warn(`飞书 audit 表建表失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx);
                    this.auditReady = undefined;
                });
            }
            // 不等建表完成就直接 INSERT——表不存在时 query 会抛错被 catch 静默
            void this.connection.rawConnection
                .query(`INSERT INTO feishu_audit_log (chat_id, open_id, cmd_name, card_action, order_code, result)
                     VALUES ($1, $2, $3, $4, $5, $6)`, [chatId, openId, cmd.name, (_b = cmd.cardAction) !== null && _b !== void 0 ? _b : null, (_c = cmd.orderCode) !== null && _c !== void 0 ? _c : null, result])
                .catch(() => undefined); // 落库失败不影响业务
        }
        catch (_d) {
            // 任何异常都不抛出——audit 是旁路
        }
    }
};
exports.FeishuCommandService = FeishuCommandService;
exports.FeishuCommandService = FeishuCommandService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [feishu_config_1.FeishuConfigService,
        feishu_client_1.FeishuClient,
        feishu_card_service_1.FeishuCardService,
        core_1.RequestContextService,
        core_1.TransactionalConnection,
        merchant_admin_service_1.MerchantAdminService,
        dispatch_admin_service_1.DispatchAdminService,
        delivery_stats_service_1.DeliveryStatsService,
        hall_service_1.HallService,
        rider_task_service_1.RiderTaskService,
        campus_dedupe_service_1.CampusDedupeService])
], FeishuCommandService);
//# sourceMappingURL=feishu.command.service.js.map