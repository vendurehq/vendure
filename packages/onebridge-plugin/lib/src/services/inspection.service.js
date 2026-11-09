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
exports.OnebridgeInspectionService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const codes_1 = require("../codes");
const errors_1 = require("../errors");
const entities_1 = require("../entities");
const types_1 = require("../types");
const channel_context_1 = require("./channel-context");
const rfq_service_1 = require("./rfq.service");
/** 验货报告（CT-07）：Admin 上传/发布，Shop 仅可见已发布且归属本人的单据。 */
let OnebridgeInspectionService = class OnebridgeInspectionService {
    constructor(connection, customerService, orderService, rfqService) {
        this.connection = connection;
        this.customerService = customerService;
        this.orderService = orderService;
        this.rfqService = rfqService;
    }
    async create(ctx, input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        (0, channel_context_1.resolveChannelToken)(ctx);
        if (!types_1.INSPECTION_RESULTS.includes(input.result)) {
            throw new core_1.UserInputError(`Unknown inspection result: ${input.result}`);
        }
        if (!((_a = input.inspector) === null || _a === void 0 ? void 0 : _a.trim()))
            throw new core_1.UserInputError('inspector is required');
        if (!((_b = input.orderCode) === null || _b === void 0 ? void 0 : _b.trim()) && !((_c = input.rfqCode) === null || _c === void 0 ? void 0 : _c.trim())) {
            throw new core_1.UserInputError('orderCode or rfqCode is required');
        }
        const now = new Date();
        const inspectedAt = input.inspectedAt ? new Date(input.inspectedAt) : now;
        for (let attempt = 0; attempt < 5; attempt++) {
            const prefix = `QC-${(0, codes_1.buildInspectionCode)(now, 1).split('-')[1]}-`;
            const count = await this.repo(ctx)
                .createQueryBuilder('report')
                .where('report.code LIKE :prefix', { prefix: `${prefix}%` })
                .getCount();
            try {
                return await this.repo(ctx).save(new entities_1.InspectionReport({
                    code: (0, codes_1.buildInspectionCode)(now, count + attempt + 1),
                    orderCode: ((_d = input.orderCode) === null || _d === void 0 ? void 0 : _d.trim()) || null,
                    rfqCode: ((_e = input.rfqCode) === null || _e === void 0 ? void 0 : _e.trim()) || null,
                    inspector: input.inspector.trim(),
                    inspectedAt,
                    result: input.result,
                    photos: (_f = input.photos) !== null && _f !== void 0 ? _f : null,
                    notesKr: (_g = input.notesKr) !== null && _g !== void 0 ? _g : null,
                    notesCn: (_h = input.notesCn) !== null && _h !== void 0 ? _h : null,
                    passed: (_j = input.passed) !== null && _j !== void 0 ? _j : input.result === 'pass',
                }));
            }
            catch (e) {
                if (!/unique|duplicate|constraint/i.test((_k = e === null || e === void 0 ? void 0 : e.message) !== null && _k !== void 0 ? _k : ''))
                    throw e;
            }
        }
        throw new core_1.UserInputError('Unable to allocate inspection code, please retry');
    }
    async publish(ctx, id) {
        (0, channel_context_1.resolveChannelToken)(ctx);
        const report = await this.repo(ctx).findOne({ where: { id: Number(id) } });
        if (!report)
            throw new core_1.UserInputError(`Inspection report ${id} not found`);
        if (!report.publishedAt) {
            report.publishedAt = new Date();
            await this.repo(ctx).save(report);
        }
        return report;
    }
    async shopList(ctx, args) {
        (0, channel_context_1.resolveChannelToken)(ctx);
        if (!args.orderCode && !args.rfqCode) {
            throw new core_1.UserInputError('orderCode or rfqCode is required');
        }
        const qb = this.repo(ctx)
            .createQueryBuilder('report')
            .where('report.publishedAt IS NOT NULL');
        if (args.orderCode) {
            await this.assertOrderOwnership(ctx, args.orderCode);
            qb.andWhere('report.orderCode = :orderCode', { orderCode: args.orderCode });
        }
        if (args.rfqCode) {
            await this.rfqService.findRfqForCustomer(ctx, args.rfqCode);
            qb.andWhere('report.rfqCode = :rfqCode', { rfqCode: args.rfqCode });
        }
        return qb.orderBy('report.inspectedAt', 'DESC').getMany();
    }
    async adminList(ctx, options) {
        var _a, _b;
        (0, channel_context_1.resolveChannelToken)(ctx);
        const qb = this.repo(ctx).createQueryBuilder('report');
        if (options === null || options === void 0 ? void 0 : options.orderCode)
            qb.andWhere('report.orderCode = :orderCode', { orderCode: options.orderCode });
        if (options === null || options === void 0 ? void 0 : options.rfqCode)
            qb.andWhere('report.rfqCode = :rfqCode', { rfqCode: options.rfqCode });
        if (options === null || options === void 0 ? void 0 : options.result)
            qb.andWhere('report.result = :result', { result: options.result });
        if ((options === null || options === void 0 ? void 0 : options.published) !== undefined) {
            qb.andWhere(options.published ? 'report.publishedAt IS NOT NULL' : 'report.publishedAt IS NULL');
        }
        qb.orderBy('report.inspectedAt', 'DESC')
            .skip(Math.max(0, (_a = options === null || options === void 0 ? void 0 : options.skip) !== null && _a !== void 0 ? _a : 0))
            .take(Math.min(100, Math.max(1, (_b = options === null || options === void 0 ? void 0 : options.take) !== null && _b !== void 0 ? _b : 20)));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }
    repo(ctx) {
        return this.connection.getRepository(ctx, entities_1.InspectionReport);
    }
    async assertOrderOwnership(ctx, orderCode) {
        var _a;
        if (!ctx.activeUserId)
            throw new core_1.UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['customer']);
        if (!customer || !order || ((_a = order.customer) === null || _a === void 0 ? void 0 : _a.id) !== customer.id) {
            throw errors_1.Errors.orderNotFound(orderCode);
        }
    }
};
exports.OnebridgeInspectionService = OnebridgeInspectionService;
exports.OnebridgeInspectionService = OnebridgeInspectionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.CustomerService,
        core_1.OrderService,
        rfq_service_1.OnebridgeRfqService])
], OnebridgeInspectionService);
//# sourceMappingURL=inspection.service.js.map