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
exports.FeishuRiderGrabService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const hall_grab_service_1 = require("../hall-grab.service");
const rider_service_1 = require("../rider.service");
const feishu_client_1 = require("./feishu.client");
const feishu_config_1 = require("./feishu.config");
const loggerCtx = 'Feishu';
/**
 * 骑手群抢单回调：飞书 open_id → 骑手 Customer → 构造带 activeUserId 的 ctx → 复用 HallGrabService.grab。
 * 权限判定全部落在 grab → assertApprovedRider（骑手状态/信用分/合规），本服务不重复实现。
 * 与商家群指令隔离：本服务只认 scope='rider' 的群和 rider_grab 动作，绝不转发给 FeishuCommandService。
 */
let FeishuRiderGrabService = class FeishuRiderGrabService {
    constructor(cfg, client, connection, requestContextService, riderService, hallGrab) {
        this.cfg = cfg;
        this.client = client;
        this.connection = connection;
        this.requestContextService = requestContextService;
        this.riderService = riderService;
        this.hallGrab = hallGrab;
    }
    /** 骑手群判定（事件层分流用） */
    isRiderChat(chatId) {
        var _a;
        return ((_a = this.cfg.chatOf(chatId)) === null || _a === void 0 ? void 0 : _a.scope) === 'rider';
    }
    /** 骑手群文本消息：只提示点卡片按钮，不解析任何指令（避免复用商家指令面） */
    async handleText(input) {
        if (!this.client.riderEnabled)
            return;
        if (!this.isRiderChat(input.chatId))
            return;
        await this.client.sendToChat(input.chatId, '骑手群仅支持点击「新单待抢」卡片上的「抢单」按钮，暂不支持文本指令。', { app: 'rider' });
    }
    /** 卡片回调：校验群 scope 与动作 → 反查骑手 → 抢单 → 回执（全部走骑手独立应用） */
    async handleCardAction(input) {
        var _a, _b, _c, _d, _e, _f, _g;
        const { chatId, openId, messageId } = input;
        if (!this.client.riderEnabled)
            return;
        // 双重保险：事件层已按 scope 分流，这里再拒绝非骑手群，防止误配后被当成骑手回调
        if (!this.isRiderChat(chatId)) {
            core_1.Logger.warn(`非骑手群收到 rider_grab 回调，已拒绝 chat=${chatId}`, loggerCtx);
            return;
        }
        const action = String((_b = (_a = input.value) === null || _a === void 0 ? void 0 : _a.a) !== null && _b !== void 0 ? _b : '');
        if (action !== 'rider_grab') {
            await this.reply(chatId, messageId, '不支持的卡片操作。');
            return;
        }
        const code = typeof ((_c = input.value) === null || _c === void 0 ? void 0 : _c.c) === 'string' ? input.value.c : '';
        if (!code) {
            await this.reply(chatId, messageId, '卡片缺少订单信息，请使用最新推送的抢单卡片。');
            return;
        }
        const riderAppId = String((_d = this.cfg.settings.riderAppId) !== null && _d !== void 0 ? _d : '');
        const resolution = await this.riderService.resolveFeishuRider(openId, riderAppId);
        switch (resolution.kind) {
            case 'unbound':
                // 运营补绑需要能定位到人：打出 open_id + 群/消息锚点（后台可按 open_id 查飞书通讯录）
                core_1.Logger.warn(`飞书抢单未绑定骑手 open_id=${openId} app=${riderAppId || '-'} chat=${chatId} `
                    + `message=${messageId !== null && messageId !== void 0 ? messageId : '-'} order=${code}`, loggerCtx);
                await this.reply(chatId, messageId, '你的飞书账号尚未绑定骑手身份，请联系运营绑定后重试。');
                return;
            case 'legacyBinding':
                core_1.Logger.warn(`飞书抢单绑定已失效（缺少应用标识或来自旧应用） open_id=${openId} app=${riderAppId || '-'} `
                    + `chat=${chatId} message=${messageId !== null && messageId !== void 0 ? messageId : '-'} order=${code}；请运营解绑后重新绑定`, loggerCtx);
                await this.reply(chatId, messageId, '你的飞书绑定来自旧应用或缺少应用标识，已失效，请联系运营重新绑定后重试。');
                return;
            case 'conflict':
                await this.reply(chatId, messageId, '你的飞书账号存在多条骑手绑定，请联系运营解绑多余绑定后重试。');
                return;
            case 'notApproved':
                await this.reply(chatId, messageId, '你的骑手账号未通过审核或已停用，暂不能抢单。');
                return;
            default:
                break;
        }
        const customer = resolution.customer;
        const user = customer.user;
        if (!user) {
            core_1.Logger.warn(`骑手 ${customer.id} 未关联登录用户，无法构造抢单上下文`, loggerCtx);
            await this.reply(chatId, messageId, '你的骑手账号缺少登录信息，请联系运营处理。');
            return;
        }
        const order = await this.connection.rawConnection.getRepository(core_1.Order).findOne({
            where: { code },
            relations: ['channels'],
        });
        if (!order) {
            await this.reply(chatId, messageId, `未找到订单：${code}`);
            return;
        }
        // 卡片 value 同时带订单主键，双校验防止旧卡片/伪造单号串单
        const cardOrderId = (_e = input.value) === null || _e === void 0 ? void 0 : _e.o;
        if (cardOrderId != null && String(order.id) !== String(cardOrderId)) {
            await this.reply(chatId, messageId, '卡片与订单不匹配，请使用最新推送的抢单卡片。');
            return;
        }
        const channel = (_f = order.channels) === null || _f === void 0 ? void 0 : _f[0];
        if (!channel) {
            core_1.Logger.warn(`订单 ${code} 未绑定渠道，无法抢单`, loggerCtx);
            await this.reply(chatId, messageId, '该订单未绑定店铺，暂时无法抢单。');
            return;
        }
        try {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: channel.token,
                user,
            });
            const grabbed = await this.hallGrab.grab(ctx, order.id);
            core_1.Logger.info(`飞书抢单成功 chat=${chatId} open_id=${openId} rider=${customer.id} order=${grabbed.code}`, loggerCtx);
            await this.reply(chatId, messageId, `抢单成功：${grabbed.code}，请尽快前往商家取餐。`);
        }
        catch (e) {
            const msg = (_g = e === null || e === void 0 ? void 0 : e.message) !== null && _g !== void 0 ? _g : String(e);
            core_1.Logger.info(`飞书抢单失败 chat=${chatId} open_id=${openId} order=${code} result=${msg}`, loggerCtx);
            await this.reply(chatId, messageId, `抢单失败：${msg}`);
        }
    }
    /** 优先回在卡片话题里，拿不到锚点消息时退回群消息；统一走骑手独立应用 */
    async reply(chatId, messageId, text) {
        var _a;
        if (messageId) {
            try {
                if (await this.client.replyToMessage(messageId, text, true, 'rider'))
                    return;
            }
            catch (e) {
                core_1.Logger.warn(`飞书骑手回执线程回复失败 anchor=${messageId}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx);
            }
        }
        await this.client.sendToChat(chatId, text, { app: 'rider' });
    }
};
exports.FeishuRiderGrabService = FeishuRiderGrabService;
exports.FeishuRiderGrabService = FeishuRiderGrabService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [feishu_config_1.FeishuConfigService,
        feishu_client_1.FeishuClient,
        core_1.TransactionalConnection,
        core_1.RequestContextService,
        rider_service_1.RiderService,
        hall_grab_service_1.HallGrabService])
], FeishuRiderGrabService);
//# sourceMappingURL=feishu-rider-grab.service.js.map