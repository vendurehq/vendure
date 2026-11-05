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
exports.CampusAdService = void 0;
// P2-3 广告位与商家自助投放计费：下单（按天计费）→ 模拟支付 → 平台审核 → 按日期投放。
//
// 商家侧只能看到/操作本渠道投放单；平台侧按渠道查询并审核。
// 已结束状态不落库，按投放结束日实时判定（避免额外定时任务）。
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
const campus_ad_entity_1 = require("./campus-ad.entity");
const ad_slots_1 = require("./ad-slots");
const campus_time_1 = require("./campus-time");
const MAX_ACTIVE_PER_SLOT = 3;
let CampusAdService = class CampusAdService {
    constructor(connection) {
        this.connection = connection;
    }
    repo(ctx) {
        return this.connection.getRepository(ctx, campus_ad_entity_1.CampusAdCampaign);
    }
    today() {
        return (0, campus_time_1.campusDayKey)(Date.now());
    }
    /** 对外视图：status 按日期改写为 finished，并给出 live */
    toView(row) {
        const today = this.today();
        return Object.assign(Object.assign({}, row), { status: (0, ad_slots_1.adViewStatus)(row, today), live: (0, ad_slots_1.isAdLive)(row, today) });
    }
    slotList() {
        return ad_slots_1.AD_SLOTS.map(s => ({ code: s.code, name: s.name, unitPriceFen: s.unitPriceFen }));
    }
    /** 商家侧：本渠道投放单（最近 50 条） */
    async merchantList(ctx) {
        const rows = await this.repo(ctx).find({ where: { channelId: ctx.channelId }, order: { createdAt: 'DESC' }, take: 50 });
        return rows.map(r => this.toView(r));
    }
    /** 商家下单：校验广告位与素材，按下单当时的单价固化总价，状态 pendingPay */
    async create(ctx, input) {
        var _a, _b, _c, _d;
        const slot = (0, ad_slots_1.findAdSlot)(String((_a = input === null || input === void 0 ? void 0 : input.slot) !== null && _a !== void 0 ? _a : '').trim());
        const title = String((_b = input === null || input === void 0 ? void 0 : input.title) !== null && _b !== void 0 ? _b : '').trim();
        if (!title)
            throw new core_1.UserInputError('广告标题不能为空');
        if (title.length > 40)
            throw new core_1.UserInputError('广告标题不能超过 40 个字符');
        const imageUrl = String((_c = input === null || input === void 0 ? void 0 : input.imageUrl) !== null && _c !== void 0 ? _c : '').trim();
        if (imageUrl) {
            if (!/^https?:\/\//i.test(imageUrl) || imageUrl.length > 512)
                throw new core_1.UserInputError('广告图片需为 http(s) 地址且不超过 512 字符');
        }
        const linkUrl = String((_d = input === null || input === void 0 ? void 0 : input.linkUrl) !== null && _d !== void 0 ? _d : '').trim();
        if (linkUrl) {
            if (!/^(https?:\/\/|\/pages\/)/i.test(linkUrl) || linkUrl.length > 255)
                throw new core_1.UserInputError('跳转链接需为 http(s) 地址或以 /pages/ 开头的站内路径');
        }
        const quote = (0, ad_slots_1.calcAdQuote)(slot.code, input.startDate, input.endDate);
        const row = await this.repo(ctx).save(new campus_ad_entity_1.CampusAdCampaign({
            channelId: ctx.channelId,
            slot: slot.code,
            title,
            imageUrl: imageUrl || null,
            linkUrl: linkUrl || null,
            startDate: (0, ad_slots_1.normalizeAdDate)(input.startDate, '开始日期'),
            endDate: (0, ad_slots_1.normalizeAdDate)(input.endDate, '结束日期'),
            days: quote.days,
            unitPriceFen: quote.unitPriceFen,
            totalFen: quote.totalFen,
            status: 'pendingPay',
            createdBy: ctx.activeUserId ? String(ctx.activeUserId) : null,
        }));
        return this.toView(row);
    }
    /** 商家支付（模拟）：生成支付流水号并转待审核；重复支付幂等返回 */
    async pay(ctx, id) {
        const row = await this.findOwn(ctx, id);
        if (row.status === 'pendingReview' || row.status === 'running' || row.status === 'finished')
            return this.toView(row);
        if (row.status !== 'pendingPay')
            throw new core_1.UserInputError('当前状态不可支付');
        row.status = 'pendingReview';
        row.payRef = `ADPAY-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
        row.paidAt = new Date();
        await this.repo(ctx).save(row);
        return this.toView(row);
    }
    /** 商家取消：仅未支付/待审核可取消 */
    async cancel(ctx, id) {
        const row = await this.findOwn(ctx, id);
        if (row.status !== 'pendingPay' && row.status !== 'pendingReview')
            throw new core_1.UserInputError('当前状态不可取消');
        row.status = 'cancelled';
        await this.repo(ctx).save(row);
        return this.toView(row);
    }
    /**
     * 平台侧：按渠道/状态分页查询投放单（§122）。
     * status 是视图态：finished 在库里仍是 running，按结束日反推，
     * 保证「筛选口径 = 列表 pill 口径」；take 默认 20、上限 100。
     */
    async adminList(ctx, status, channelId, skip = 0, take = 20) {
        const where = {};
        if (channelId)
            where.channelId = channelId;
        else
            where.channelId = ctx.channelId;
        const st = String(status !== null && status !== void 0 ? status : '').trim();
        const today = this.today();
        if (st === 'finished') {
            where.status = 'running';
            where.endDate = (0, typeorm_1.LessThan)(today);
        }
        else if (st === 'running') {
            where.status = 'running';
            where.endDate = (0, typeorm_1.MoreThanOrEqual)(today);
        }
        else if (st) {
            where.status = st;
        }
        const safeTake = Math.min(100, Math.max(1, Math.floor(Number(take) || 20)));
        const safeSkip = Math.max(0, Math.floor(Number(skip) || 0));
        const [rows, total] = await this.repo(ctx).findAndCount({
            where,
            order: { createdAt: 'DESC', id: 'DESC' },
            skip: safeSkip,
            take: safeTake,
        });
        return { total, items: rows.map(r => this.toView(r)) };
    }
    /** 平台审核：通过 → running；驳回 → rejected（须填原因） */
    async review(ctx, id, approve, note) {
        const row = await this.repo(ctx).findOne({ where: { id: id } });
        if (!row)
            throw new core_1.UserInputError('投放单不存在');
        if (row.status !== 'pendingReview')
            throw new core_1.UserInputError('只有待审核的投放单可以审核');
        const reason = String(note !== null && note !== void 0 ? note : '').trim();
        if (!approve && !reason)
            throw new core_1.UserInputError('驳回时必须填写原因');
        if (reason.length > 200)
            throw new core_1.UserInputError('审核备注不能超过 200 个字符');
        row.status = approve ? 'running' : 'rejected';
        row.reviewNote = reason || null;
        row.reviewedBy = ctx.activeUserId ? String(ctx.activeUserId) : null;
        row.reviewedAt = new Date();
        await this.repo(ctx).save(row);
        return this.toView(row);
    }
    /** C 端公开：本渠道某广告位当前在投的广告（最多 3 条） */
    async activeAds(ctx, slotCode) {
        const slot = (0, ad_slots_1.findAdSlot)(String(slotCode !== null && slotCode !== void 0 ? slotCode : '').trim());
        const today = this.today();
        const rows = await this.repo(ctx).find({
            where: { channelId: ctx.channelId, slot: slot.code, status: 'running' },
            order: { totalFen: 'DESC', createdAt: 'ASC' },
            take: MAX_ACTIVE_PER_SLOT,
        });
        return rows.filter(r => (0, ad_slots_1.isAdLive)(r, today)).map(r => ({
            id: r.id,
            slot: r.slot,
            title: r.title,
            imageUrl: r.imageUrl,
            linkUrl: r.linkUrl,
            endDate: r.endDate,
        }));
    }
    async findOwn(ctx, id) {
        const row = await this.repo(ctx).findOne({ where: { id: id, channelId: ctx.channelId } });
        if (!row)
            throw new core_1.UserInputError('投放单不存在');
        return row;
    }
};
exports.CampusAdService = CampusAdService;
exports.CampusAdService = CampusAdService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], CampusAdService);
//# sourceMappingURL=campus-ad.service.js.map