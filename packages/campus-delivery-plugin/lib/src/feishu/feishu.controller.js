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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeishuController = void 0;
const common_1 = require("@nestjs/common");
const feishu_event_service_1 = require("./feishu.event.service");
function header(v) {
    return Array.isArray(v) ? v[0] : v;
}
/**
 * 飞书开放平台回调（事件订阅）。
 * - /feishu/event：运维告警应用（告警广播/店铺指令/工单通知）
 * - /feishu/rider/event：骑手抢单独立应用（只用骑手应用自己的 verifyToken/encryptKey）
 * nginx 需把 /feishu/ 反代到 Vendure（proxy_pass 末尾不要加 /，否则路径被改写）。
 */
let FeishuController = class FeishuController {
    constructor(events) {
        this.events = events;
    }
    async event(body, req, res) {
        const result = await this.events.handle(body, {
            timestamp: header(req.headers['x-lark-request-timestamp']),
            nonce: header(req.headers['x-lark-request-nonce']),
            signature: header(req.headers['x-lark-signature']),
        });
        res.status(result.status).json(result.body);
    }
    /** 骑手独立应用回调：与运维回调完全隔离，两者加密凭证不同 */
    async riderEvent(body, req, res) {
        const result = await this.events.handle(body, {
            timestamp: header(req.headers['x-lark-request-timestamp']),
            nonce: header(req.headers['x-lark-request-nonce']),
            signature: header(req.headers['x-lark-signature']),
        }, 'rider');
        res.status(result.status).json(result.body);
    }
};
exports.FeishuController = FeishuController;
__decorate([
    (0, common_1.Post)('event'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], FeishuController.prototype, "event", null);
__decorate([
    (0, common_1.Post)('rider/event'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], FeishuController.prototype, "riderEvent", null);
exports.FeishuController = FeishuController = __decorate([
    (0, common_1.Controller)('feishu'),
    __metadata("design:paramtypes", [feishu_event_service_1.FeishuEventService])
], FeishuController);
//# sourceMappingURL=feishu.controller.js.map