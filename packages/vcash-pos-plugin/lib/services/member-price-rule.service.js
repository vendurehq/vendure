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
exports.MemberPriceRuleService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const typeorm_2 = require("typeorm");
const member_price_rule_entity_1 = require("../entities/member-price-rule.entity");
/**
 * 会员价规则服务：
 * - 提供 CRUD（admin 管理）
 * - 提供 findEffectiveRule：按 channel + memberLevel + category 查询生效规则
 *   优先级：category > global（priority 字段大的优先）
 */
let MemberPriceRuleService = class MemberPriceRuleService {
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
            throw new core_1.UserInputError('无权访问其他渠道的会员价规则');
        }
        return current;
    }
    async findAll(ctx, channelId) {
        const qb = this.connection
            .getRepository(member_price_rule_entity_1.MemberPriceRule)
            .createQueryBuilder('rule')
            .where('rule.channelId = :channelId', { channelId: this.assertChannel(ctx, channelId) });
        return qb.orderBy('rule.memberLevel', 'ASC').addOrderBy('rule.priority', 'DESC').getMany();
    }
    /**
     * 按 id + 渠道查询。跨渠道 id 返回 null（调用方据此拒绝 update/delete）。
     */
    async findOne(ctx, id) {
        const channelId = this.assertChannel(ctx);
        return this.connection
            .getRepository(member_price_rule_entity_1.MemberPriceRule)
            .findOne({ where: { id, channelId } });
    }
    async create(ctx, input) {
        var _a, _b, _c;
        this.validateInput(input);
        const rule = new member_price_rule_entity_1.MemberPriceRule();
        rule.channelId = ctx.channelId;
        rule.scope = input.scope;
        rule.categoryId = input.scope === 'category' ? ((_a = input.categoryId) !== null && _a !== void 0 ? _a : null) : null;
        rule.memberLevel = input.memberLevel;
        rule.discountPercent = input.discountPercent;
        rule.active = (_b = input.active) !== null && _b !== void 0 ? _b : true;
        rule.priority = (_c = input.priority) !== null && _c !== void 0 ? _c : (input.scope === 'category' ? 100 : 10);
        return this.connection.getRepository(member_price_rule_entity_1.MemberPriceRule).save(rule);
    }
    async update(ctx, id, input) {
        var _a;
        const rule = await this.findOne(ctx, id);
        if (!rule)
            throw new core_1.UserInputError(`会员价规则 ${id} 不存在`);
        if (input.scope !== undefined)
            rule.scope = input.scope;
        if (input.categoryId !== undefined)
            rule.categoryId = (_a = input.categoryId) !== null && _a !== void 0 ? _a : null;
        if (input.memberLevel !== undefined)
            rule.memberLevel = input.memberLevel;
        if (input.discountPercent !== undefined)
            rule.discountPercent = input.discountPercent;
        if (input.active !== undefined)
            rule.active = input.active;
        if (input.priority !== undefined)
            rule.priority = input.priority;
        this.validateInput(rule);
        return this.connection.getRepository(member_price_rule_entity_1.MemberPriceRule).save(rule);
    }
    async delete(ctx, id) {
        var _a;
        const channelId = this.assertChannel(ctx);
        const res = await this.connection
            .getRepository(member_price_rule_entity_1.MemberPriceRule)
            .delete({ id, channelId });
        return ((_a = res.affected) !== null && _a !== void 0 ? _a : 0) > 0;
    }
    /**
     * 查询生效规则：先查 category（指定 categoryId + memberLevel），未命中则查 global。
     * 若同一层有多条规则，priority 大者优先；priority 相同取 discountPercent 更低（更优惠）。
     */
    async findEffectiveRule(ctx, memberLevel, categoryId) {
        const channelId = ctx.channelId;
        const repo = this.connection.getRepository(member_price_rule_entity_1.MemberPriceRule);
        // 1. category 规则（仅当提供 categoryId）
        if (categoryId != null) {
            const catRule = await repo
                .createQueryBuilder('rule')
                .where('rule.channelId = :channelId', { channelId })
                .andWhere('rule.scope = :scope', { scope: 'category' })
                .andWhere('rule.categoryId = :categoryId', { categoryId })
                .andWhere('rule.memberLevel = :memberLevel', { memberLevel })
                .andWhere('rule.active = :active', { active: true })
                .orderBy('rule.priority', 'DESC')
                .addOrderBy('rule.discountPercent', 'ASC')
                .getOne();
            if (catRule)
                return catRule;
        }
        // 2. global 规则
        return repo
            .createQueryBuilder('rule')
            .where('rule.channelId = :channelId', { channelId })
            .andWhere('rule.scope = :scope', { scope: 'global' })
            .andWhere('rule.memberLevel = :memberLevel', { memberLevel })
            .andWhere('rule.active = :active', { active: true })
            .orderBy('rule.priority', 'DESC')
            .addOrderBy('rule.discountPercent', 'ASC')
            .getOne();
    }
    validateInput(input) {
        if (input.memberLevel < 1 || input.memberLevel > 5) {
            throw new core_1.UserInputError('memberLevel 必须为 1-5');
        }
        if (input.discountPercent < 1 || input.discountPercent > 100) {
            throw new core_1.UserInputError('discountPercent 必须为 1-100');
        }
        if (input.scope === 'category' && input.categoryId == null) {
            throw new core_1.UserInputError('scope=category 时必须提供 categoryId');
        }
    }
};
exports.MemberPriceRuleService = MemberPriceRuleService;
exports.MemberPriceRuleService = MemberPriceRuleService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], MemberPriceRuleService);
//# sourceMappingURL=member-price-rule.service.js.map