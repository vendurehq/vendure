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
exports.PromotionEngineService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const typeorm_2 = require("typeorm");
const promotion_rule_service_1 = require("./promotion-rule.service");
/**
 * 促销引擎：枚举候选 → 选最优 → 应用。
 * 互斥原则：会员价与所有促销规则两两互斥，取 saving 最大者；saving 相同 priority 大者优先。
 */
let PromotionEngineService = class PromotionEngineService {
    constructor(connection, transactionalConnection, ruleService, orderService, stockLevelService) {
        this.connection = connection;
        this.transactionalConnection = transactionalConnection;
        this.ruleService = ruleService;
        this.orderService = orderService;
        this.stockLevelService = stockLevelService;
    }
    /**
     * 枚举所有候选方案（会员价 + active 规则），返回最优。
     * 若所有候选 saving ≤ 0 返回 null。
     * stockLocationId：用于买赠库存校验；为 null 时跳过库存校验（向后兼容）
     */
    async calculateBest(ctx, order, member, stockLocationId = null) {
        const candidates = [];
        // 1. 会员价候选
        const memberCandidate = await this.calculateMemberCandidate(order, member);
        if (memberCandidate && memberCandidate.saving > 0) {
            candidates.push(memberCandidate);
        }
        // 2. 促销规则候选
        const rules = await this.ruleService.findActiveRules(ctx);
        for (const rule of rules) {
            const candidate = await this.calculateRuleCandidate(ctx, rule, order, stockLocationId);
            if (candidate && candidate.saving > 0) {
                candidates.push(candidate);
            }
        }
        if (candidates.length === 0)
            return null;
        // 3. 排序：saving DESC → priority DESC → ruleId ASC（确定性）
        candidates.sort((a, b) => {
            var _a, _b;
            if (b.saving !== a.saving)
                return b.saving - a.saving;
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            // 会员价（ruleId=null）排在规则之后
            const aId = (_a = a.ruleId) !== null && _a !== void 0 ? _a : Number.MAX_SAFE_INTEGER;
            const bId = (_b = b.ruleId) !== null && _b !== void 0 ? _b : Number.MAX_SAFE_INTEGER;
            return aId - bId;
        });
        return candidates[0];
    }
    /**
     * 会员价候选：saving = sum over memberPriceApplied lines: (initialListPrice - listPrice) * quantity
     */
    async calculateMemberCandidate(order, member) {
        var _a, _b, _c, _d;
        if (!member)
            return null;
        let saving = 0;
        for (const line of order.lines) {
            const cf = (_a = line.customFields) !== null && _a !== void 0 ? _a : {};
            if (!cf.memberPriceApplied)
                continue;
            const initial = (_c = (_b = line.initialListPrice) !== null && _b !== void 0 ? _b : line.unitPriceWithTax) !== null && _c !== void 0 ? _c : 0;
            const current = (_d = line.listPrice) !== null && _d !== void 0 ? _d : 0;
            saving += (initial - current) * line.quantity;
        }
        if (saving <= 0)
            return null;
        return {
            ruleId: null,
            type: 'memberPrice',
            saving,
            priority: 0, // 会员价 priority 固定 0，低于任何 active 规则
        };
    }
    async calculateRuleCandidate(ctx, rule, order, stockLocationId) {
        if (rule.type === 'fullReduction') {
            return this.calculateFullReductionCandidate(rule, order);
        }
        if (rule.type === 'discount') {
            return this.calculateDiscountCandidate(rule, order);
        }
        if (rule.type === 'buyGift') {
            return this.calculateBuyGiftCandidate(ctx, rule, order, stockLocationId);
        }
        return null;
    }
    /**
     * 满减：在 order.subTotal 上找最高满足的 tier，saving = reduction
     */
    calculateFullReductionCandidate(rule, order) {
        var _a, _b;
        const tiers = (_b = (_a = rule.conditions) === null || _a === void 0 ? void 0 : _a.tiers) !== null && _b !== void 0 ? _b : [];
        if (tiers.length === 0)
            return null;
        // 排除 gift 行后的 subTotal
        const subTotal = this.computeEffectiveSubTotal(order);
        let hitTier = null;
        for (const t of tiers) {
            if (subTotal >= t.threshold) {
                if (!hitTier || t.threshold > hitTier.threshold) {
                    hitTier = t;
                }
            }
        }
        if (!hitTier)
            return null;
        return {
            ruleId: rule.id,
            type: 'fullReduction',
            saving: hitTier.reduction,
            priority: rule.priority,
            payload: { tier: hitTier },
        };
    }
    /**
     * 整单折扣：若 subTotal < minOrderValue 返回 null；saving = floor(subTotal * (100 - dp) / 100)
     */
    calculateDiscountCandidate(rule, order) {
        var _a, _b, _c;
        const dp = (_a = rule.actions) === null || _a === void 0 ? void 0 : _a.discountPercent;
        if (typeof dp !== 'number' || dp < 1 || dp > 100)
            return null;
        const subTotal = this.computeEffectiveSubTotal(order);
        const minOrderValue = (_c = (_b = rule.conditions) === null || _b === void 0 ? void 0 : _b.minOrderValue) !== null && _c !== void 0 ? _c : 0;
        if (subTotal < minOrderValue)
            return null;
        const saving = Math.floor((subTotal * (100 - dp)) / 100);
        if (saving <= 0)
            return null;
        return {
            ruleId: rule.id,
            type: 'discount',
            saving,
            priority: rule.priority,
        };
    }
    /**
     * 买赠：检查 order 是否命中 buyVariantId × buyQuantity；命中则 saving = giftVariant.price × giftQuantity
     * 库存校验：stockLocationId 非空时，检查 giftVariant 在该库存点的可用库存（stockOnHand - stockAllocated）≥ giftQuantity
     */
    async calculateBuyGiftCandidate(ctx, rule, order, stockLocationId) {
        var _a, _b, _c, _d, _e, _f;
        const buyVariantId = (_a = rule.conditions) === null || _a === void 0 ? void 0 : _a.buyVariantId;
        const buyQuantity = (_b = rule.conditions) === null || _b === void 0 ? void 0 : _b.buyQuantity;
        const giftVariantId = (_c = rule.actions) === null || _c === void 0 ? void 0 : _c.giftVariantId;
        const giftQuantity = (_d = rule.actions) === null || _d === void 0 ? void 0 : _d.giftQuantity;
        if (typeof buyVariantId !== 'number' ||
            typeof buyQuantity !== 'number' ||
            typeof giftVariantId !== 'number' ||
            typeof giftQuantity !== 'number') {
            return null;
        }
        // 命中判定：order 中非 gift 行该 variant 累计数量 ≥ buyQuantity
        // productVariant.id 是 Vendure ID 格式（'T_1'），需用 parseId 解析后比较
        const matchedQty = order.lines
            .filter((l) => { var _a; return !((_a = l.customFields) === null || _a === void 0 ? void 0 : _a.isGift); })
            .filter((l) => this.parseId(l.productVariant.id) === buyVariantId)
            .reduce((sum, l) => sum + l.quantity, 0);
        if (matchedQty < buyQuantity)
            return null;
        // 库存校验：giftVariant 在 stockLocationId 的可用库存 ≥ giftQuantity
        // 可用库存 = stockOnHand - stockAllocated（已分配未发货的库存）
        // 注意：gift 行加入订单时会触发 allocation（stockAllocated++），所以校验的是"扣除已分配后的剩余"
        if (stockLocationId != null) {
            const stockLevel = await this.stockLevelService.getStockLevel(ctx, giftVariantId, stockLocationId);
            const available = stockLevel.stockOnHand - stockLevel.stockAllocated;
            if (available < giftQuantity) {
                // 库存不足，候选失败（不抛错，静默跳过，让其他候选可能胜出）
                return null;
            }
        }
        // 查 gift variant 当前 channel 的 price
        // 注意：ProductVariant.price 是 @Calculated 字段，依赖 listPrice（运行时计算）
        // 直接 findOne 时 listPrice 未设置，price 返回 0；需查 productVariantPrices 关联取真实价格
        const giftVariant = await this.connection
            .getRepository(core_1.ProductVariant)
            .findOne({
            where: { id: giftVariantId },
            relations: ['productVariantPrices'],
        });
        if (!giftVariant)
            return null;
        const priceForChannel = (_e = giftVariant.productVariantPrices) === null || _e === void 0 ? void 0 : _e.find((p) => Number(p.channelId) === Number(ctx.channelId));
        const giftPrice = (_f = priceForChannel === null || priceForChannel === void 0 ? void 0 : priceForChannel.price) !== null && _f !== void 0 ? _f : 0;
        const saving = giftPrice * giftQuantity;
        if (saving <= 0)
            return null;
        return {
            ruleId: rule.id,
            type: 'buyGift',
            saving,
            priority: rule.priority,
            payload: { giftVariantId, giftQuantity, giftPrice },
        };
    }
    /**
     * 计算有效 subTotal（原价基准）：排除 isGift 行，用 initialListPrice 而非 listPrice
     * 因为 listPrice 可能已被会员价修改，互斥对比必须基于原价才公平
     */
    computeEffectiveSubTotal(order) {
        return order.lines
            .filter((l) => { var _a; return !((_a = l.customFields) === null || _a === void 0 ? void 0 : _a.isGift); })
            .reduce((sum, l) => { var _a, _b; return sum + ((_b = (_a = l.initialListPrice) !== null && _a !== void 0 ? _a : l.listPrice) !== null && _b !== void 0 ? _b : 0) * l.quantity; }, 0);
    }
    /**
     * 解析 Vendure ID（'T_1' → 1）
     */
    parseId(id) {
        var _a;
        const s = String(id !== null && id !== void 0 ? id : '');
        const parts = s.split('_');
        const num = parseInt((_a = parts[parts.length - 1]) !== null && _a !== void 0 ? _a : '0', 10);
        return Number.isFinite(num) ? num : 0;
    }
    /**
     * 撤销订单中所有 memberPriceApplied=true 行的 listPrice 到 initialListPrice。
     * 用于 winning 是促销规则（非会员价）时，确保顾客只享受促销优惠（互斥）。
     * 注意：仅恢复 listPrice，不重置 memberPriceApplied 标志（不影响 saving 计算，因 saving = initial - listPrice = 0）
     */
    async revertMemberPriceLines(order) {
        var _a, _b, _c;
        for (const line of order.lines) {
            const cf = (_a = line.customFields) !== null && _a !== void 0 ? _a : {};
            if (cf.memberPriceApplied) {
                const initial = (_c = (_b = line.initialListPrice) !== null && _b !== void 0 ? _b : line.listPrice) !== null && _c !== void 0 ? _c : 0;
                if (line.listPrice !== initial) {
                    await this.connection.getRepository(core_1.OrderLine).update(Number(line.id), {
                        listPrice: initial,
                    });
                }
            }
        }
    }
    // ===== 应用层 =====
    /**
     * 重新应用促销：清理旧促销 → 计算 winning → 应用。
     * 返回更新后的 order。
     * customer 参数：可传 Customer 实体或轻量 { id } 对象，统一转 { id: number, customFields? }
     * stockLocationId：班次库存点 ID，用于买赠库存校验；null 时跳过校验
     */
    async reapply(ctx, session, order) {
        var _a;
        // 1. 清理旧促销（gift line + order customFields）
        await this.clearPreviousPromotion(ctx, order);
        // 2. 计算最优
        const rawCustomer = session.customer;
        const member = rawCustomer
            ? { id: Number(rawCustomer.id), customFields: rawCustomer.customFields }
            : null;
        // 重新加载 order（clearPrevious 可能修改了 lines）
        const orderForCalc = (await this.orderService.findOne(ctx, order.id));
        if (!orderForCalc)
            return order;
        const best = await this.calculateBest(ctx, orderForCalc, member, (_a = session.stockLocationId) !== null && _a !== void 0 ? _a : null);
        // 3. 应用
        if (!best) {
            return orderForCalc;
        }
        if (best.type === 'memberPrice') {
            await this.applyMember(ctx, orderForCalc);
        }
        else {
            // winning 是促销规则（非会员价）：先 revert 会员价行 listPrice 到原价，确保互斥
            // （addPosItem 阶段可能已应用会员价修改 listPrice，需恢复以避免叠加优惠）
            await this.revertMemberPriceLines(orderForCalc);
            if (best.type === 'fullReduction') {
                const rule = await this.ruleService.findOne(ctx, best.ruleId);
                if (rule)
                    await this.applyFullReduction(ctx, orderForCalc, rule, best.payload.tier);
            }
            else if (best.type === 'discount') {
                const rule = await this.ruleService.findOne(ctx, best.ruleId);
                if (rule)
                    await this.applyDiscount(ctx, orderForCalc, rule);
            }
            else if (best.type === 'buyGift') {
                const rule = await this.ruleService.findOne(ctx, best.ruleId);
                if (rule)
                    await this.applyBuyGift(ctx, orderForCalc, rule);
            }
        }
        return (await this.orderService.findOne(ctx, order.id));
    }
    /**
     * 清理旧促销：
     * 1. 删除所有 giftRuleId != null 的 OrderLine（buyGift 加的赠品行）
     * 2. 重置 order.customFields.promotionId/Type/Discount 为 null
     */
    async clearPreviousPromotion(ctx, order) {
        var _a;
        const giftLines = order.lines.filter((l) => {
            var _a;
            const cf = (_a = l.customFields) !== null && _a !== void 0 ? _a : {};
            return cf.giftRuleId != null || cf.isGift === true;
        });
        for (const line of giftLines) {
            try {
                await this.orderService.removeItemFromOrder(ctx, order.id, line.id);
            }
            catch (_b) {
                // 行可能已被其他流程删除，忽略
            }
        }
        await this.connection.getRepository(core_1.Order).update(order.id, {
            customFields: Object.assign(Object.assign({}, ((_a = order.customFields) !== null && _a !== void 0 ? _a : {})), { promotionId: null, promotionType: null, promotionDiscount: null }),
        });
    }
    async applyMember(ctx, order) {
        // 会员价已应用到 line.listPrice（addPosItem 时），此处仅标注 order.customFields
        await this.updateOrderPromotionFields(order, {
            promotionId: null,
            promotionType: 'memberPrice',
            promotionDiscount: null,
        });
    }
    async applyFullReduction(ctx, order, rule, tier) {
        await this.updateOrderPromotionFields(order, {
            promotionId: rule.id,
            promotionType: 'fullReduction',
            promotionDiscount: tier.reduction,
        });
    }
    async applyDiscount(ctx, order, rule) {
        var _a, _b;
        const dp = (_b = (_a = rule.actions) === null || _a === void 0 ? void 0 : _a.discountPercent) !== null && _b !== void 0 ? _b : 100;
        const subTotal = this.computeEffectiveSubTotal(order);
        const discount = Math.floor((subTotal * (100 - dp)) / 100);
        await this.updateOrderPromotionFields(order, {
            promotionId: rule.id,
            promotionType: 'discount',
            promotionDiscount: discount,
        });
    }
    async applyBuyGift(ctx, order, rule) {
        var _a, _b;
        const giftVariantId = (_a = rule.actions) === null || _a === void 0 ? void 0 : _a.giftVariantId;
        const giftQuantity = (_b = rule.actions) === null || _b === void 0 ? void 0 : _b.giftQuantity;
        if (typeof giftVariantId !== 'number' || typeof giftQuantity !== 'number')
            return;
        // 加 gift 行：customFields.isGift=true, originalPrice=0, discount=100, note=`买赠:${rule.name}`, giftRuleId=rule.id
        const result = await this.orderService.addItemToOrder(ctx, order.id, giftVariantId, giftQuantity, {
            originalPrice: 0,
            discount: 100,
            memberPriceApplied: false,
            isGift: true,
            note: `买赠:${rule.name}`,
            giftRuleId: rule.id,
        });
        if ('errorCode' in result) {
            throw new core_1.UserInputError(`加赠品行失败: ${result.message}`);
        }
        // gift 行 listPrice 置 0（addItemToOrder 会按 variant.price 设置，需覆盖）
        const reloaded = await this.orderService.findOne(ctx, order.id);
        if (reloaded) {
            const giftLine = reloaded.lines.find((l) => { var _a; return ((_a = l.customFields) === null || _a === void 0 ? void 0 : _a.giftRuleId) === rule.id; });
            if (giftLine) {
                await this.connection.getRepository(core_1.OrderLine).update(Number(giftLine.id), {
                    listPrice: 0,
                });
            }
        }
        await this.updateOrderPromotionFields(order, {
            promotionId: rule.id,
            promotionType: 'buyGift',
            promotionDiscount: 0, // 买赠优惠体现在 gift 行 listPrice=0，order 级 discount 标 0
        });
    }
    async updateOrderPromotionFields(order, fields) {
        var _a;
        const existingCf = (_a = order.customFields) !== null && _a !== void 0 ? _a : {};
        await this.connection.getRepository(core_1.Order).update(order.id, {
            customFields: Object.assign(Object.assign({}, existingCf), { promotionId: fields.promotionId, promotionType: fields.promotionType, promotionDiscount: fields.promotionDiscount }),
        });
    }
};
exports.PromotionEngineService = PromotionEngineService;
exports.PromotionEngineService = PromotionEngineService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __param(1, (0, common_1.Inject)(core_1.TransactionalConnection)),
    __param(2, (0, common_1.Inject)(promotion_rule_service_1.PromotionRuleService)),
    __param(3, (0, common_1.Inject)(core_1.OrderService)),
    __param(4, (0, common_1.Inject)(core_1.StockLevelService)),
    __metadata("design:paramtypes", [typeorm_2.Connection,
        core_1.TransactionalConnection,
        promotion_rule_service_1.PromotionRuleService,
        core_1.OrderService,
        core_1.StockLevelService])
], PromotionEngineService);
//# sourceMappingURL=promotion-engine.service.js.map