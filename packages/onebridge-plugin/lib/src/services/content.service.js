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
exports.OnebridgeContentService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const entities_1 = require("../entities");
const types_1 = require("../types");
const channel_context_1 = require("./channel-context");
/** 内容实体（CT-03）：标题/正文成对多语；韩文必填，中文可缺省由前端回落。 */
let OnebridgeContentService = class OnebridgeContentService {
    constructor(connection) {
        this.connection = connection;
    }
    // ===== Shop =====
    async shopList(ctx, type, options) {
        var _a;
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        const where = { channelToken, contentType: type, published: true };
        if (options === null || options === void 0 ? void 0 : options.needType)
            where.needType = options.needType;
        return this.repo(ctx).find({
            where,
            order: { sort: 'ASC', createdAt: 'ASC' },
            take: Math.min(100, Math.max(1, (_a = options === null || options === void 0 ? void 0 : options.take) !== null && _a !== void 0 ? _a : 50)),
        });
    }
    /** 单条已发布内容（C 端详情页 P13/P16 用） */
    async shopFindBySlug(ctx, type, slug) {
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        return this.repo(ctx).findOne({
            where: { channelToken, contentType: type, slug: slug.trim(), published: true },
        });
    }
    /** 频道级配置（CT-03 serviceChannels），数据源为 Channel customField 的 struct list */
    serviceChannels(ctx) {
        var _a;
        const configured = (_a = ctx.channel.customFields) === null || _a === void 0 ? void 0 : _a.onebridgeServiceChannels;
        if (!Array.isArray(configured))
            return [];
        return configured
            .filter((item) => types_1.NEED_TYPES.includes(item === null || item === void 0 ? void 0 : item.needType))
            .map((item) => (Object.assign(Object.assign({}, item), { points: this.parsePoints(item === null || item === void 0 ? void 0 : item.pointsJson), pointsJson: undefined })));
    }
    // ===== Admin =====
    async adminList(ctx, options) {
        var _a, _b;
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        const qb = this.repo(ctx).createQueryBuilder('entry').where('entry.channelToken = :channelToken', {
            channelToken,
        });
        if (options === null || options === void 0 ? void 0 : options.contentType) {
            qb.andWhere('entry.contentType = :contentType', { contentType: options.contentType });
        }
        if (options === null || options === void 0 ? void 0 : options.needType)
            qb.andWhere('entry.needType = :needType', { needType: options.needType });
        if ((options === null || options === void 0 ? void 0 : options.published) !== undefined) {
            qb.andWhere('entry.published = :published', { published: options.published });
        }
        if (options === null || options === void 0 ? void 0 : options.keyword) {
            qb.andWhere('(entry.slug LIKE :kw OR entry.titleKr LIKE :kw OR entry.titleCn LIKE :kw)', {
                kw: `%${options.keyword.trim()}%`,
            });
        }
        qb.orderBy('entry.contentType', 'ASC')
            .addOrderBy('entry.sort', 'ASC')
            .skip(Math.max(0, (_a = options === null || options === void 0 ? void 0 : options.skip) !== null && _a !== void 0 ? _a : 0))
            .take(Math.min(100, Math.max(1, (_b = options === null || options === void 0 ? void 0 : options.take) !== null && _b !== void 0 ? _b : 20)));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }
    async save(ctx, input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        this.validate(input);
        const repo = this.repo(ctx);
        let entry = null;
        if (input.id) {
            entry = await repo.findOne({ where: { id: Number(input.id), channelToken } });
            if (!entry)
                throw new core_1.UserInputError(`Content entry ${input.id} not found`);
        }
        else {
            // 幂等：同一 (channel, type, slug) 视为更新，避免重复种子产生副本
            entry = await repo.findOne({
                where: { channelToken, contentType: input.contentType, slug: input.slug.trim() },
            });
        }
        const target = entry !== null && entry !== void 0 ? entry : new entities_1.ContentEntry({ channelToken });
        target.contentType = input.contentType;
        target.slug = input.slug.trim();
        target.needType = (_a = input.needType) !== null && _a !== void 0 ? _a : null;
        target.titleKr = input.titleKr.trim();
        target.titleCn = ((_b = input.titleCn) === null || _b === void 0 ? void 0 : _b.trim()) || null;
        target.titleEn = ((_c = input.titleEn) === null || _c === void 0 ? void 0 : _c.trim()) || null;
        target.bodyKr = (_d = input.bodyKr) !== null && _d !== void 0 ? _d : null;
        target.bodyCn = (_e = input.bodyCn) !== null && _e !== void 0 ? _e : null;
        target.bodyEn = (_f = input.bodyEn) !== null && _f !== void 0 ? _f : null;
        target.who = (_g = input.who) !== null && _g !== void 0 ? _g : null;
        target.caseResult = (_h = input.caseResult) !== null && _h !== void 0 ? _h : null;
        target.eta = (_j = input.eta) !== null && _j !== void 0 ? _j : null;
        target.tag = (_k = input.tag) !== null && _k !== void 0 ? _k : null;
        target.color = (_l = input.color) !== null && _l !== void 0 ? _l : null;
        target.images = (_m = input.images) !== null && _m !== void 0 ? _m : null;
        target.payload = (_o = input.payload) !== null && _o !== void 0 ? _o : null;
        target.sort = (_p = input.sort) !== null && _p !== void 0 ? _p : 0;
        if (input.published !== undefined) {
            target.published = input.published;
            // 取消发布需把列写回 NULL；可选 Date 属性不接受 null 字面量，这里显式断言
            target.publishedAt = input.published ? (_q = target.publishedAt) !== null && _q !== void 0 ? _q : new Date() : null;
        }
        return repo.save(target);
    }
    async delete(ctx, id) {
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        const repo = this.repo(ctx);
        const entry = await repo.findOne({ where: { id: Number(id), channelToken } });
        if (!entry)
            return false;
        await repo.remove(entry);
        return true;
    }
    repo(ctx) {
        return this.connection.getRepository(ctx, entities_1.ContentEntry);
    }
    validate(input) {
        var _a, _b;
        if (!types_1.CONTENT_TYPES.includes(input.contentType)) {
            throw new core_1.UserInputError(`Unknown content type: ${input.contentType}`);
        }
        if (!((_a = input.slug) === null || _a === void 0 ? void 0 : _a.trim()))
            throw new core_1.UserInputError('slug is required');
        if (!((_b = input.titleKr) === null || _b === void 0 ? void 0 : _b.trim()))
            throw new core_1.UserInputError('titleKr is required');
        if (input.needType && !types_1.NEED_TYPES.includes(input.needType)) {
            throw new core_1.UserInputError(`Unknown need type: ${input.needType}`);
        }
    }
    parsePoints(value) {
        if (typeof value !== 'string' || !value.trim())
            return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch (_a) {
            return [];
        }
    }
};
exports.OnebridgeContentService = OnebridgeContentService;
exports.OnebridgeContentService = OnebridgeContentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], OnebridgeContentService);
//# sourceMappingURL=content.service.js.map