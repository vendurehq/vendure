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
exports.FeishuNotifyService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const campus_dedupe_service_1 = require("../campus-dedupe.service");
const feishu_card_service_1 = require("./feishu-card.service");
const feishu_client_1 = require("./feishu.client");
const feishu_templates_1 = require("./feishu.templates");
const loggerCtx = 'Feishu';
const DEDUPE_MS = 2 * 60000;
/**
 * 管理侧外发：订阅 notification-plugin 的 AdminNotifyEvent，把新订单/售后推到飞书群；
 * 新订单优先发订单卡片（尾号 + 按钮 + 话题归集），卡片失败再降级为文本；
 * 外卖插件内部的异常/超时也走 push() 复用同一条通道。
 * 未启用、未配置、发送失败一律静默降级，绝不阻塞订单主流程。
 */
let FeishuNotifyService = class FeishuNotifyService {
    constructor(client, cards, 
    /** M4 跨实例去重（多实例下同一告警只推一次）；未注入时退回进程内 Map */
    dedupe) {
        this.client = client;
        this.cards = cards;
        this.dedupe = dedupe;
        this.recent = new Map();
    }
    async onAdminNotify(event) {
        var _a, _b;
        if (!this.client.enabled)
            return;
        const dedupeKey = event.orderCode || event.orderId != null
            ? `${event.scene}:${event.orderId != null ? String(event.orderId) : event.orderCode}`
            : undefined;
        if (dedupeKey && (await this.isDuplicate(dedupeKey)))
            return;
        // 订单级消息只发「本店群 + 平台群」：A 店单号/楼栋/金额不得出现在 B 店群
        const channelToken = (_a = event.ctx.channel) === null || _a === void 0 ? void 0 : _a.token;
        if (event.scene === 'shop_new_order' && event.orderCode) {
            try {
                if (await this.cards.broadcastOrderCard(event.orderCode, channelToken)) {
                    if (dedupeKey)
                        await this.mark(dedupeKey);
                    return;
                }
            }
            catch (e) {
                core_1.Logger.warn(`新订单卡片发送失败，降级文本：${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, loggerCtx);
            }
        }
        const link = event.link
            ? `${process.env.ADMIN_UI_BASE_URL || 'https://e.joho.cn'}${event.link.startsWith('/') ? '' : '/'}${event.link}`
            : undefined;
        const text = (0, feishu_templates_1.formatPush)({
            scene: event.scene,
            title: event.title,
            content: event.content,
            orderCode: event.orderCode,
            link,
            at: Date.now(),
        });
        // 卡片降级文本同样按渠道定向（无渠道时维持原全量广播，避免通知静默丢失）
        const target = event.scene === 'shop_new_order' && channelToken ? { channel: channelToken } : undefined;
        if (await this.deliver(text, event.scene, target)) {
            if (dedupeKey)
                await this.mark(dedupeKey);
        }
    }
    /** 内部事件（异常/超时/支付取消）直接推群；按业务键 2 分钟去重。
     * 返回是否送达（未启用/去重命中记为 true，避免调用方无意义重试）。 */
    async push(scene, dedupeKey, text, target) {
        if (!this.client.enabled)
            return true;
        const key = dedupeKey ? `${scene}:${dedupeKey}` : undefined;
        if (key && (await this.isDuplicate(key)))
            return true;
        const ok = await this.deliver(text, scene, target);
        if (ok && key)
            await this.mark(key);
        return ok;
    }
    /** 返回是否已送达/已合并到卡片：false 表示本次推送失败，调用方应保留重试机会。 */
    async pushEvent(scene, title, content, orderCode, dedupeKey, target) {
        if (!this.client.enabled)
            return true;
        // 缺省键必须带事件标题：同一订单 2 分钟内可能连发多个不同事件（如取货超时告警 + 回厅），
        // 只用 orderCode 会把后到的那条吞掉。显式传键的调用方保持原语义。
        const key = dedupeKey !== null && dedupeKey !== void 0 ? dedupeKey : (orderCode ? `${orderCode}:${title}` : undefined);
        if (key && (await this.isDuplicate(key)))
            return true;
        // P2.1 同单告警合并：有 orderCode 时先尝试 PATCH 已有订单卡片追加告警行，找不到再降级广播文本
        if (orderCode) {
            const alertText = `${title} · ${content}`;
            // Bug 2 修复：把 dedupeKey 透传给 appendAlert，用于精确匹配（同告警类型但内容不同如 13→14min 会追加新行）
            const alertDedupeKey = key !== null && key !== void 0 ? key : dedupeKey;
            if (await this.cards.appendAlert(orderCode, alertText, alertDedupeKey)) {
                // 已合并到卡片，不再额外发文本
                if (key)
                    await this.mark(key);
                return true;
            }
        }
        // 订单级告警默认按订单所属店铺定向（平台群始终接收）：
        // 旧实现各处调用不传 target，会把单号/异常描述广播到所有店铺群。
        // 调用方显式传入 target 时尊重调用方（如平台级汇总告警）。
        if (orderCode && !target) {
            try {
                const channelToken = await this.cards.channelTokenForOrder(orderCode);
                if (channelToken)
                    target = { channel: channelToken };
            }
            catch ( /* 查询失败退化为原有广播 */_a) { /* 查询失败退化为原有广播 */ }
        }
        const ok = await this.push(scene, key, (0, feishu_templates_1.formatPush)({ scene, title, content, orderCode, at: Date.now() }), target);
        if (ok && key)
            await this.mark(key);
        return ok;
    }
    /** 大厅新单 → 骑手群抢单卡片。未配置骑手应用/骑手群/未启用/发送失败只告警，绝不阻塞订单流程 */
    async pushRiderGrab(orderCode) {
        var _a;
        if (!this.client.enabled)
            return;
        // 骑手独立应用未配置时降级关闭：启动日志已告警，这里静默跳过，不影响运维告警
        if (!this.client.riderEnabled)
            return;
        if (!this.client.riderChatIds.length) {
            core_1.Logger.warn(`未配置骑手群（FEISHU_CHAT_MAP scope:"rider"），跳过抢单推送：${orderCode}`, loggerCtx);
            return;
        }
        try {
            const card = await this.cards.buildRiderGrabCard(orderCode);
            if (!card) {
                core_1.Logger.warn(`抢单卡片生成失败（订单不存在？）：${orderCode}`, loggerCtx);
                return;
            }
            const sent = await this.client.broadcastRiderCard(card);
            if (sent === 0)
                core_1.Logger.warn(`抢单卡片未送达骑手群：${orderCode}`, loggerCtx);
        }
        catch (e) {
            core_1.Logger.warn(`骑手抢单推送异常（已忽略）：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx);
        }
    }
    /** 飞书通道是否可用（未启用时业务侧只记录日志、不外发） */
    get enabled() {
        return this.client.enabled;
    }
    async deliver(text, scene, target) {
        var _a;
        try {
            const ok = await this.client.broadcast(text, target);
            if (!ok)
                core_1.Logger.warn(`飞书推送未送达 scene=${scene}`, loggerCtx);
            return ok;
        }
        catch (e) {
            core_1.Logger.warn(`飞书推送异常 scene=${scene}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx);
            return false;
        }
    }
    /** 送达成功后才登记去重键：发送失败不应占用去重窗口，否则失败一次会静默整整一个窗口。 */
    async mark(key) {
        if (this.dedupe) {
            await this.dedupe.mark(key, DEDUPE_MS);
            return;
        }
        this.recent.set(key, Date.now());
    }
    // Bug 6 修复：同 Bug 5，Map 遍历时 delete 跳过元素导致泄漏；改数组收集再统一 delete
    async isDuplicate(key) {
        if (this.dedupe)
            return this.dedupe.seen(key, DEDUPE_MS);
        const now = Date.now();
        const expired = [];
        for (const [k, at] of this.recent) {
            if (now - at > DEDUPE_MS)
                expired.push(k);
        }
        for (const k of expired)
            this.recent.delete(k);
        const seen = this.recent.get(key);
        return seen != null && now - seen <= DEDUPE_MS;
    }
};
exports.FeishuNotifyService = FeishuNotifyService;
exports.FeishuNotifyService = FeishuNotifyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [feishu_client_1.FeishuClient,
        feishu_card_service_1.FeishuCardService,
        campus_dedupe_service_1.CampusDedupeService])
], FeishuNotifyService);
//# sourceMappingURL=feishu-notify.service.js.map