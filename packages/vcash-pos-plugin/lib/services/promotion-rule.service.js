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
exports.PromotionRuleService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const typeorm_2 = require("typeorm");
const promotion_rule_entity_1 = require("../entities/promotion-rule.entity");
/**
 * 促销规则服务：CRUD + findActiveRules。
 * 校验：conditions/actions 必须与 type 匹配（type-specific validation）。
 */
let PromotionRuleService = class PromotionRuleService {
    constructor(connection) {
        this.connection = connection;
    }
    /**
     * 解析并校验渠道：只允许操作当前请求渠道的数据。
     * 显式传了其他渠道 id 时直接拒绝，避免跨租户读取/改写。
     */
    assertChannel(ctx, channelId) {
        const current = Number(ctx.channelId);
        if (!Number.isFinite(current)) {
            throw new core_1.UserInputError('当前请求未绑定渠道');
        }
        if (channelId != null && Number(channelId) !== current) {
            throw new core_1.UserInputError('无权访问其他渠道的促销规则');
        }
        return current;
    }
    async findAll(ctx, channelId) {
        const targetChannelId = this.assertChannel(ctx, channelId);
        return this.connection
            .getRepository(promotion_rule_entity_1.PromotionRule)
            .createQueryBuilder('rule')
            .where('rule.channelId = :channelId', { channelId: targetChannelId })
            .orderBy('rule.priority', 'DESC')
            .addOrderBy('rule.id', 'ASC')
            .getMany();
    }
    /**
     * 按 id + 渠道查询。跨渠道 id 返回 null（调用方据此拒绝 update/delete）。
     */
    async findOne(ctx, id) {
        const channelId = this.assertChannel(ctx);
        return this.connection
            .getRepository(promotion_rule_entity_1.PromotionRule)
            .findOne({ where: { id, channelId } });
    }
    /**
     * 返回当前时段有效的规则（active=true 且 currentTime 在 [startTime, endTime] 内）。
     * 按 priority DESC 排序。
     */
    async findActiveRules(ctx) {
        const now = new Date();
        const qb = this.connection
            .getRepository(promotion_rule_entity_1.PromotionRule)
            .createQueryBuilder('rule')
            .where('rule.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('rule.active = :active', { active: true })
            .andWhere('(rule.startTime IS NULL OR rule.startTime <= :now)', { now })
            .andWhere('(rule.endTime IS NULL OR rule.endTime >= :now)', { now })
            .orderBy('rule.priority', 'DESC')
            .addOrderBy('rule.id', 'ASC');
        return qb.getMany();
    }
    async create(ctx, input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        this.validateInput(input);
        const rule = new promotion_rule_entity_1.PromotionRule();
        rule.channelId = ctx.channelId;
        rule.type = input.type;
        rule.name = input.name;
        rule.description = (_a = input.description) !== null && _a !== void 0 ? _a : null;
        rule.scope = (_b = input.scope) !== null && _b !== void 0 ? _b : 'global';
        rule.collectionId = input.scope === 'collection' ? ((_c = input.collectionId) !== null && _c !== void 0 ? _c : null) : null;
        rule.priority = (_d = input.priority) !== null && _d !== void 0 ? _d : 10;
        rule.active = (_e = input.active) !== null && _e !== void 0 ? _e : true;
        rule.startTime = (_f = input.startTime) !== null && _f !== void 0 ? _f : null;
        rule.endTime = (_g = input.endTime) !== null && _g !== void 0 ? _g : null;
        rule.conditions = (_h = input.conditions) !== null && _h !== void 0 ? _h : null;
        rule.actions = (_j = input.actions) !== null && _j !== void 0 ? _j : null;
        return this.connection.getRepository(promotion_rule_entity_1.PromotionRule).save(rule);
    }
    async update(ctx, id, input) {
        var _a, _b, _c, _d, _e, _f;
        const rule = await this.findOne(ctx, id);
        if (!rule)
            throw new core_1.UserInputError(`促销规则 ${id} 不存在`);
        if (input.type !== undefined)
            rule.type = input.type;
        if (input.name !== undefined)
            rule.name = input.name;
        if (input.description !== undefined)
            rule.description = (_a = input.description) !== null && _a !== void 0 ? _a : null;
        if (input.scope !== undefined)
            rule.scope = input.scope;
        if (input.collectionId !== undefined)
            rule.collectionId = (_b = input.collectionId) !== null && _b !== void 0 ? _b : null;
        if (input.priority !== undefined)
            rule.priority = input.priority;
        if (input.active !== undefined)
            rule.active = input.active;
        if (input.startTime !== undefined)
            rule.startTime = (_c = input.startTime) !== null && _c !== void 0 ? _c : null;
        if (input.endTime !== undefined)
            rule.endTime = (_d = input.endTime) !== null && _d !== void 0 ? _d : null;
        if (input.conditions !== undefined)
            rule.conditions = (_e = input.conditions) !== null && _e !== void 0 ? _e : null;
        if (input.actions !== undefined)
            rule.actions = (_f = input.actions) !== null && _f !== void 0 ? _f : null;
        this.validateInput(rule);
        return this.connection.getRepository(promotion_rule_entity_1.PromotionRule).save(rule);
    }
    async delete(ctx, id) {
        var _a;
        const channelId = this.assertChannel(ctx);
        const res = await this.connection
            .getRepository(promotion_rule_entity_1.PromotionRule)
            .delete({ id, channelId });
        if (((_a = res.affected) !== null && _a !== void 0 ? _a : 0) === 0) {
            throw new core_1.UserInputError(`促销规则 ${id} 不存在或不属于当前渠道`);
        }
        return true;
    }
    /**
     * type-specific 校验：conditions/actions 必须与 type 匹配。
     * - fullReduction: conditions.tiers 必须非空且 threshold 递增；actions 可为 null
     * - discount: actions.discountPercent ∈ [1,100]；conditions.minOrderValue 可选 ≥ 0
     * - buyGift: conditions.buyVariantId/buyQuantity > 0；actions.giftVariantId/giftQuantity > 0
     */
    validateInput(input) {
        const type = input.type;
        const conditions = input.conditions;
        const actions = input.actions;
        if (!input.name || input.name.trim() === '') {
            throw new core_1.UserInputError('name 不能为空');
        }
        if (type === 'fullReduction') {
            const tiers = conditions === null || conditions === void 0 ? void 0 : conditions.tiers;
            if (!Array.isArray(tiers) || tiers.length === 0) {
                throw new core_1.UserInputError('fullReduction.conditions.tiers 必须为非空数组');
            }
            for (const t of tiers) {
                if (typeof t.threshold !== 'number' ||
                    typeof t.reduction !== 'number' ||
                    t.threshold < 0 ||
                    t.reduction < 0 ||
                    t.reduction > t.threshold) {
                    throw new core_1.UserInputError('tier.threshold/reduction 必须为非负数且 reduction ≤ threshold');
                }
            }
            // 阶梯必须按 threshold 递增
            for (let i = 1; i < tiers.length; i++) {
                if (tiers[i].threshold <= tiers[i - 1].threshold) {
                    throw new core_1.UserInputError('tiers.threshold 必须严格递增');
                }
            }
        }
        else if (type === 'discount') {
            const dp = actions === null || actions === void 0 ? void 0 : actions.discountPercent;
            if (typeof dp !== 'number' || dp < 1 || dp > 100) {
                throw new core_1.UserInputError('discount.actions.discountPercent 必须为 1-100');
            }
            if ((conditions === null || conditions === void 0 ? void 0 : conditions.minOrderValue) != null && typeof conditions.minOrderValue !== 'number') {
                throw new core_1.UserInputError('discount.conditions.minOrderValue 必须为数字');
            }
        }
        else if (type === 'buyGift') {
            if (typeof (conditions === null || conditions === void 0 ? void 0 : conditions.buyVariantId) !== 'number' ||
                typeof (conditions === null || conditions === void 0 ? void 0 : conditions.buyQuantity) !== 'number' ||
                conditions.buyQuantity < 1) {
                throw new core_1.UserInputError('buyGift.conditions.buyVariantId/buyQuantity 必须为正数');
            }
            if (typeof (actions === null || actions === void 0 ? void 0 : actions.giftVariantId) !== 'number' ||
                typeof (actions === null || actions === void 0 ? void 0 : actions.giftQuantity) !== 'number' ||
                actions.giftQuantity < 1) {
                throw new core_1.UserInputError('buyGift.actions.giftVariantId/giftQuantity 必须为正数');
            }
        }
        else {
            throw new core_1.UserInputError(`不支持的促销类型: ${type}`);
        }
        if (input.scope === 'collection' && !input.collectionId) {
            throw new core_1.UserInputError('scope=collection 时必须提供 collectionId');
        }
    }
};
exports.PromotionRuleService = PromotionRuleService;
exports.PromotionRuleService = PromotionRuleService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], PromotionRuleService);
//# sourceMappingURL=promotion-rule.service.js.map