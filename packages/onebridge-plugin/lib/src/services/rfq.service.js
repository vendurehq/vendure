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
exports.OnebridgeRfqService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const codes_1 = require("../codes");
const errors_1 = require("../errors");
const entities_1 = require("../entities");
const stages_1 = require("../stages");
const transitions_1 = require("../transitions");
const types_1 = require("../types");
const channel_context_1 = require("./channel-context");
/**
 * 前台模块 → 初始阶段/业务线（CT-01 + CT-02）。
 * daily 走标准订单，提交即待付款；logistics 为横切底座，无独立业务线。
 */
const NEED_INITIAL = {
    logistics: { labelZh: '物流通道询价', stage: 'requirement', line: null },
    daily: { labelZh: '日用精选询价', stage: 'wait_pay', line: 'net' },
    collections: { labelZh: '精选专栏询价', stage: 'quoting', line: 'pond' },
    projects: { labelZh: '项目定制询价', stage: 'requirement', line: 'hook' },
};
function isUniqueViolation(e) {
    var _a;
    const message = (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : '';
    return /unique|duplicate|constraint/i.test(message);
}
function asDate(value) {
    if (!value)
        return null;
    return value instanceof Date ? value : new Date(value);
}
let OnebridgeRfqService = class OnebridgeRfqService {
    constructor(connection, customerService) {
        this.connection = connection;
        this.customerService = customerService;
    }
    // ===== Shop =====
    async submitRfq(ctx, input) {
        var _a, _b, _c, _d;
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        this.validateSubmitInput(input);
        if (input.idempotencyKey) {
            const existing = await this.rfqRepo(ctx).findOne({ where: { idempotencyKey: input.idempotencyKey } });
            if (existing) {
                if (existing.channelToken !== channelToken) {
                    throw errors_1.Errors.validationFailed('idempotencyKey belongs to another channel');
                }
                return existing;
            }
        }
        const now = new Date();
        const customerId = await this.currentCustomerId(ctx);
        const meta = NEED_INITIAL[input.need];
        const base = {
            channelToken,
            needType: input.need,
            needLabel: meta.labelZh,
            customerName: input.name.trim(),
            customerContact: input.contact.trim(),
            locale: input.locale,
            item: input.item.trim(),
            qty: ((_a = input.qty) === null || _a === void 0 ? void 0 : _a.trim()) || null,
            eta: ((_b = input.eta) === null || _b === void 0 ? void 0 : _b.trim()) || null,
            memo: ((_c = input.memo) === null || _c === void 0 ? void 0 : _c.trim()) || null,
            stage: meta.stage,
            businessLine: meta.line,
            customerId,
            idempotencyKey: (_d = input.idempotencyKey) !== null && _d !== void 0 ? _d : null,
        };
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = await this.nextRfqCode(ctx, now, attempt);
            try {
                const saved = await this.rfqRepo(ctx).save(new entities_1.Rfq(Object.assign(Object.assign({}, base), { code })));
                await this.appendStageEvent(ctx, {
                    ownerType: 'rfq',
                    ownerCode: code,
                    stage: meta.stage,
                    occurredAt: now,
                    state: 'now',
                    idempotencyKey: input.idempotencyKey ? `submitRfq:${input.idempotencyKey}` : null,
                });
                return saved;
            }
            catch (e) {
                // 并发下编号或幂等键冲突：命中幂等键则返回已存在单据，否则重试下一个序号
                if (input.idempotencyKey) {
                    const existing = await this.rfqRepo(ctx).findOne({
                        where: { idempotencyKey: input.idempotencyKey },
                    });
                    if (existing)
                        return existing;
                }
                if (!isUniqueViolation(e))
                    throw e;
            }
        }
        throw new core_1.UserInputError('Unable to allocate RFQ code, please retry');
    }
    async myRfqs(ctx, options) {
        var _a, _b, _c;
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        const customerId = await this.requireCustomerId(ctx);
        const take = Math.min(100, Math.max(1, (_a = options === null || options === void 0 ? void 0 : options.take) !== null && _a !== void 0 ? _a : 20));
        const skip = Math.max(0, (_b = options === null || options === void 0 ? void 0 : options.skip) !== null && _b !== void 0 ? _b : 0);
        // 只加不改：channelToken + customerId 的既有隔离条件不变，needType/stage/keyword 为新增可选过滤
        const qb = this.rfqRepo(ctx)
            .createQueryBuilder('rfq')
            .where('rfq.channelToken = :channelToken AND rfq.customerId = :customerId', {
            channelToken,
            customerId,
        });
        if (options === null || options === void 0 ? void 0 : options.needType)
            qb.andWhere('rfq.needType = :needType', { needType: options.needType });
        if (options === null || options === void 0 ? void 0 : options.stage)
            qb.andWhere('rfq.stage = :stage', { stage: options.stage });
        const keyword = (_c = options === null || options === void 0 ? void 0 : options.keyword) === null || _c === void 0 ? void 0 : _c.trim();
        if (keyword) {
            qb.andWhere('(rfq.code LIKE :kw OR rfq.item LIKE :kw OR rfq.customerName LIKE :kw)', {
                kw: `%${keyword}%`,
            });
        }
        const [items, totalItems] = await qb
            .orderBy('rfq.createdAt', 'DESC')
            .skip(skip)
            .take(take)
            .getManyAndCount();
        return { items, totalItems };
    }
    async findRfqForCustomer(ctx, code) {
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        const customerId = await this.requireCustomerId(ctx);
        const rfq = await this.rfqRepo(ctx).findOne({ where: { code, channelToken } });
        if (!rfq || rfq.customerId !== customerId) {
            throw errors_1.Errors.rfqNotFound(code);
        }
        return rfq;
    }
    // ===== Admin =====
    async adminList(ctx, options) {
        var _a, _b;
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        const qb = this.rfqRepo(ctx).createQueryBuilder('rfq').where('rfq.channelToken = :channelToken', {
            channelToken,
        });
        if (options === null || options === void 0 ? void 0 : options.needType)
            qb.andWhere('rfq.needType = :needType', { needType: options.needType });
        if (options === null || options === void 0 ? void 0 : options.stage)
            qb.andWhere('rfq.stage = :stage', { stage: options.stage });
        if (options === null || options === void 0 ? void 0 : options.keyword) {
            qb.andWhere('(rfq.code LIKE :kw OR rfq.customerName LIKE :kw)', {
                kw: `%${options.keyword.trim()}%`,
            });
        }
        qb.orderBy('rfq.createdAt', 'DESC')
            .skip(Math.max(0, (_a = options === null || options === void 0 ? void 0 : options.skip) !== null && _a !== void 0 ? _a : 0))
            .take(Math.min(100, Math.max(1, (_b = options === null || options === void 0 ? void 0 : options.take) !== null && _b !== void 0 ? _b : 20)));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }
    async adminFind(ctx, id, code) {
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        const rfq = await this.rfqRepo(ctx).findOne({
            where: id ? { id: Number(id), channelToken } : { code: code !== null && code !== void 0 ? code : '', channelToken },
        });
        if (!rfq)
            throw errors_1.Errors.rfqNotFound(code);
        return rfq;
    }
    async saveQuote(ctx, rfqId, input) {
        var _a, _b, _c;
        const rfq = await this.adminFind(ctx, rfqId);
        if (!Number.isInteger(input.amount) || input.amount < 0) {
            throw errors_1.Errors.validationFailed('quote amount must be a non-negative integer');
        }
        const repo = this.connection.getRepository(ctx, entities_1.RfqQuote);
        const existing = await repo.findOne({ where: { rfqId: Number(rfq.id) } });
        const quote = existing !== null && existing !== void 0 ? existing : new entities_1.RfqQuote({ rfqId: Number(rfq.id) });
        quote.amount = input.amount;
        quote.currency = (_a = input.currency) !== null && _a !== void 0 ? _a : 'KRW';
        quote.validUntil = (_b = asDate(input.validUntil)) !== null && _b !== void 0 ? _b : undefined;
        quote.note = ((_c = input.note) === null || _c === void 0 ? void 0 : _c.trim()) || null;
        return repo.save(quote);
    }
    async saveSample(ctx, rfqId, input) {
        var _a, _b, _c;
        const rfq = await this.adminFind(ctx, rfqId);
        if (!((_a = input.status) === null || _a === void 0 ? void 0 : _a.trim()))
            throw errors_1.Errors.validationFailed('sample status is required');
        const repo = this.connection.getRepository(ctx, entities_1.RfqSample);
        const existing = await repo.findOne({ where: { rfqId: Number(rfq.id) } });
        const sample = existing !== null && existing !== void 0 ? existing : new entities_1.RfqSample({ rfqId: Number(rfq.id) });
        sample.status = input.status.trim();
        sample.trackingNo = ((_b = input.trackingNo) === null || _b === void 0 ? void 0 : _b.trim()) || null;
        sample.confirmedAt = (_c = asDate(input.confirmedAt)) !== null && _c !== void 0 ? _c : undefined;
        return repo.save(sample);
    }
    async transitionStage(ctx, rfqId, target, detail) {
        var _a;
        if (!types_1.CROSS_BORDER_STAGES.includes(target)) {
            throw errors_1.Errors.validationFailed(`unknown CrossBorderStage: ${target}`);
        }
        const rfq = await this.adminFind(ctx, rfqId);
        if (detail === null || detail === void 0 ? void 0 : detail.idempotencyKey) {
            const existing = await this.stageEventRepo(ctx).findOne({
                where: { idempotencyKey: detail.idempotencyKey },
            });
            if (existing)
                return rfq;
        }
        (0, transitions_1.assertRfqTransition)(rfq.stage, target);
        // 未通过验货不放行（§8.4）：qc → customs/delivered 前校验最新报告
        if (rfq.stage === 'qc' && (target === 'customs' || target === 'delivered')) {
            const latest = await this.connection.getRepository(ctx, entities_1.InspectionReport).findOne({
                where: { rfqCode: rfq.code },
                order: { inspectedAt: 'DESC' },
            });
            if (latest && !latest.passed) {
                throw errors_1.Errors.inspectionNotPassed(rfq.code);
            }
        }
        const from = rfq.stage;
        rfq.stage = target;
        const saved = await this.rfqRepo(ctx).save(rfq);
        await this.stageEventRepo(ctx).update({ ownerType: 'rfq', ownerCode: rfq.code, state: 'now' }, { state: 'done' });
        const terminal = target === 'done' || target === 'lost';
        await this.appendStageEvent(ctx, {
            ownerType: 'rfq',
            ownerCode: rfq.code,
            stage: target,
            occurredAt: new Date(),
            state: terminal ? 'done' : 'now',
            title: detail === null || detail === void 0 ? void 0 : detail.title,
            desc: detail === null || detail === void 0 ? void 0 : detail.desc,
            idempotencyKey: (_a = detail === null || detail === void 0 ? void 0 : detail.idempotencyKey) !== null && _a !== void 0 ? _a : null,
            operator: ctx.activeUserId ? String(ctx.activeUserId) : null,
        });
        // 便于审计排查：保留前后状态（不落专表，日志为轻量留痕）
        // eslint-disable-next-line no-console
        console.log(`[OnebridgeRFQ] ${rfq.code} ${from} -> ${target}`);
        return saved;
    }
    // ===== 关联读取 =====
    async loadQuote(ctx, rfqId) {
        return this.connection.getRepository(ctx, entities_1.RfqQuote).findOne({ where: { rfqId } });
    }
    async loadSample(ctx, rfqId) {
        return this.connection.getRepository(ctx, entities_1.RfqSample).findOne({ where: { rfqId } });
    }
    async loadTimeline(ctx, rfqCode) {
        return this.stageEventRepo(ctx).find({
            where: { ownerType: 'rfq', ownerCode: rfqCode },
            order: { occurredAt: 'ASC' },
        });
    }
    // ===== 内部 =====
    rfqRepo(ctx) {
        return this.connection.getRepository(ctx, entities_1.Rfq);
    }
    stageEventRepo(ctx) {
        return this.connection.getRepository(ctx, entities_1.StageEvent);
    }
    async nextRfqCode(ctx, now, attempt) {
        const prefix = `OB-${(0, codes_1.buildRfqCode)(now, 1).split('-')[1]}-`;
        const count = await this.rfqRepo(ctx)
            .createQueryBuilder('rfq')
            .where('rfq.code LIKE :prefix', { prefix: `${prefix}%` })
            .getCount();
        return (0, codes_1.buildRfqCode)(now, count + attempt + 1);
    }
    async appendStageEvent(ctx, input) {
        var _a, _b, _c, _d, _e, _f;
        const label = (_b = (_a = stages_1.STAGE_META[input.stage]) === null || _a === void 0 ? void 0 : _a.labelZh) !== null && _b !== void 0 ? _b : input.stage;
        // TODO(韩文待补)：CT-01 未提供韩文文案，titleKr/descKr 暂以中文占位，禁止自造韩文
        return this.stageEventRepo(ctx).save(new entities_1.StageEvent({
            ownerType: input.ownerType,
            ownerCode: input.ownerCode,
            stage: input.stage,
            titleKr: input.title || label,
            titleCn: input.title || label,
            descKr: (_c = input.desc) !== null && _c !== void 0 ? _c : null,
            descCn: (_d = input.desc) !== null && _d !== void 0 ? _d : null,
            state: input.state,
            occurredAt: input.occurredAt,
            operator: (_e = input.operator) !== null && _e !== void 0 ? _e : null,
            idempotencyKey: (_f = input.idempotencyKey) !== null && _f !== void 0 ? _f : null,
        }));
    }
    validateSubmitInput(input) {
        var _a, _b, _c;
        if (!types_1.NEED_TYPES.includes(input.need)) {
            throw errors_1.Errors.validationFailed(`unknown need type: ${input.need}`);
        }
        if (!((_a = input.name) === null || _a === void 0 ? void 0 : _a.trim()) || input.name.trim().length > 100) {
            throw errors_1.Errors.validationFailed('name is required and must be <= 100 chars');
        }
        if (!((_b = input.contact) === null || _b === void 0 ? void 0 : _b.trim()) || input.contact.trim().length > 200) {
            throw errors_1.Errors.validationFailed('contact is required and must be <= 200 chars');
        }
        if (!((_c = input.item) === null || _c === void 0 ? void 0 : _c.trim()) || input.item.trim().length > 1000) {
            throw errors_1.Errors.validationFailed('item is required and must be <= 1000 chars');
        }
        if (input.memo && input.memo.length > 2000) {
            throw errors_1.Errors.validationFailed('memo must be <= 2000 chars');
        }
        if (input.locale !== 'ko' && input.locale !== 'zh') {
            throw errors_1.Errors.validationFailed('locale must be ko or zh');
        }
    }
    async requireCustomerId(ctx) {
        if (!ctx.activeUserId)
            throw new core_1.UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer)
            throw new core_1.UserInputError('No customer for the current user');
        return Number(customer.id);
    }
    async currentCustomerId(ctx) {
        if (!ctx.activeUserId)
            return null;
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        return customer ? Number(customer.id) : null;
    }
};
exports.OnebridgeRfqService = OnebridgeRfqService;
exports.OnebridgeRfqService = OnebridgeRfqService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.CustomerService])
], OnebridgeRfqService);
//# sourceMappingURL=rfq.service.js.map