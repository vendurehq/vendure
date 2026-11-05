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
exports.PrivacyNumberService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const waimai_store_service_1 = require("./waimai-store.service");
/**
 * 号码保护（P0）：商家/骑手/客服侧不直接拿顾客真实手机号。
 * Provider 抽象：
 * - mask：脱敏展示（零依赖，默认兜底）
 * - mock：本地虚拟号（演示用，不真实转接）
 * - aliyun / tencent：外部号池；缺凭证时运行时降级为 mask，绝不阻断订单流程
 */
let PrivacyNumberService = class PrivacyNumberService {
    constructor(connection) {
        this.connection = connection;
        /** mock 虚拟号池：同一渠道/订单/真实号在 TTL 内保持稳定 */
        this.mockPool = new Map();
        /** 降级告警去重：`channelId:provider` 只提醒一次 */
        this.degradedWarned = new Set();
    }
    /** 手机号脱敏：11 位保留前 3 后 4，其它保留首尾 */
    mask(phone) {
        const raw = String(phone !== null && phone !== void 0 ? phone : '').replace(/\s/g, '');
        if (!raw)
            return null;
        if (/^\d{11}$/.test(raw))
            return `${raw.slice(0, 3)}****${raw.slice(7)}`;
        if (raw.length >= 7)
            return `${raw.slice(0, 1)}***${raw.slice(-2)}`;
        if (raw.length >= 3)
            return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
        return '***';
    }
    /** 读取渠道隐私号配置（无配置行 = 未开启） */
    async getConfig(ctx, channelId) {
        return this.connection.getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig).findOne({
            where: { channelId: channelId },
        });
    }
    /**
     * 展示号转换器（H2）：一次读取渠道配置，返回同步转换函数。
     * 启用号码保护 → 脱敏号；未启用 → 原文。供列表/文案等 String 字段批量复用，避免逐条查配置。
     */
    async displayer(ctx, channelId) {
        const cfg = await this.getConfig(ctx, channelId);
        const enabled = !!(cfg === null || cfg === void 0 ? void 0 : cfg.privacyNumberEnabled);
        return phone => {
            const raw = String(phone !== null && phone !== void 0 ? phone : '').trim();
            if (!raw)
                return null;
            return enabled ? this.mask(raw) : raw;
        };
    }
    /**
     * 解析一个手机号在当前渠道下的展示方式。
     * 调用方：骑手任务联系人、商家工作台、客服台、运营侧工单。
     */
    async resolve(ctx, source) {
        var _a, _b, _c, _d;
        const real = String((_a = source.phone) !== null && _a !== void 0 ? _a : '').trim();
        const cfg = await this.getConfig(ctx, source.channelId);
        if (!(cfg === null || cfg === void 0 ? void 0 : cfg.privacyNumberEnabled) || !real) {
            return { protected: false, display: real || null, callable: real || null, provider: 'off', expiresAt: null, note: null };
        }
        const status = (0, waimai_store_service_1.privacyProviderStatus)(cfg);
        if (status.degraded)
            this.warnDegraded(source.channelId, status);
        if (status.effective === 'mock') {
            const ttl = Math.max(1, Number((_b = cfg.privacyNumberTtlMinutes) !== null && _b !== void 0 ? _b : 60)) * 60000;
            const key = `${source.channelId}:${(_c = source.orderCode) !== null && _c !== void 0 ? _c : ''}:${real}`;
            const now = Date.now();
            const hit = this.mockPool.get(key);
            if (hit && hit.expiresAt.getTime() > now) {
                return {
                    protected: true,
                    display: hit.number,
                    callable: hit.number,
                    provider: status.effective,
                    expiresAt: hit.expiresAt,
                    note: status.note,
                };
            }
            const prefix = String((_d = cfg.privacyNumberPrefix) !== null && _d !== void 0 ? _d : '').replace(/\D/g, '') || '1700000';
            const seed = Array.from(real).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 10000, 7);
            const number = `${prefix}${String(seed).padStart(4, '0')}`.slice(0, 11);
            const expiresAt = new Date(now + ttl);
            this.mockPool.set(key, { number, expiresAt });
            return {
                protected: true,
                display: number,
                callable: number,
                provider: status.effective,
                expiresAt,
                note: status.note,
            };
        }
        // mask 兜底（含 aliyun/tencent 未接入的降级）：只给脱敏号，不给可拨号
        return {
            protected: true,
            display: this.mask(real),
            callable: null,
            provider: status.effective,
            expiresAt: null,
            note: status.note,
        };
    }
    /** 降级告警去重：同一渠道同一服务商只提醒一次（进程内，多实例各自一条） */
    warnDegraded(channelId, status) {
        const key = `${channelId}:${status.provider}`;
        if (this.degradedWarned.has(key))
            return;
        if (this.degradedWarned.size >= 500)
            this.degradedWarned.clear();
        this.degradedWarned.add(key);
        core_1.Logger.warn(`渠道 ${channelId} 隐私号配置为 ${status.provider}，实际回落 ${status.effective}：${status.note}`, 'PrivacyNumberService');
    }
};
exports.PrivacyNumberService = PrivacyNumberService;
exports.PrivacyNumberService = PrivacyNumberService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], PrivacyNumberService);
//# sourceMappingURL=privacy-number.service.js.map