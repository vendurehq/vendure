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
exports.OnebridgeShopResolver = exports.CustomsRecordFieldResolver = exports.ServiceChannelFieldResolver = exports.OnebridgeContentFieldResolver = exports.StageEventFieldResolver = exports.RfqFieldResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const services_1 = require("../services");
let RfqFieldResolver = class RfqFieldResolver {
    constructor(rfqService) {
        this.rfqService = rfqService;
    }
    customer(rfq) {
        return {
            name: rfq.customerName,
            contact: rfq.customerContact,
            locale: rfq.locale,
            customerId: rfq.customerId,
        };
    }
    requirement(rfq) {
        return { item: rfq.item, qty: rfq.qty, eta: rfq.eta, memo: rfq.memo };
    }
    quote(rfq, ctx) {
        return this.rfqService.loadQuote(ctx, Number(rfq.id));
    }
    sample(rfq, ctx) {
        return this.rfqService.loadSample(ctx, Number(rfq.id));
    }
    timeline(rfq, ctx) {
        return this.rfqService.loadTimeline(ctx, rfq.code);
    }
};
exports.RfqFieldResolver = RfqFieldResolver;
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RfqFieldResolver.prototype, "customer", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RfqFieldResolver.prototype, "requirement", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], RfqFieldResolver.prototype, "quote", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], RfqFieldResolver.prototype, "sample", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], RfqFieldResolver.prototype, "timeline", null);
exports.RfqFieldResolver = RfqFieldResolver = __decorate([
    (0, graphql_1.Resolver)('Rfq'),
    __metadata("design:paramtypes", [services_1.OnebridgeRfqService])
], RfqFieldResolver);
let StageEventFieldResolver = class StageEventFieldResolver {
    // TODO(韩文待补)：数据库同时存 Kr/Cn，Kr 当前为中文占位；统一对外读取 Kr 字段
    title(event) {
        return event.titleKr || event.titleCn || '';
    }
    desc(event) {
        var _a, _b;
        return (_b = (_a = event.descKr) !== null && _a !== void 0 ? _a : event.descCn) !== null && _b !== void 0 ? _b : null;
    }
    time(event) {
        return event.occurredAt;
    }
};
exports.StageEventFieldResolver = StageEventFieldResolver;
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StageEventFieldResolver.prototype, "title", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StageEventFieldResolver.prototype, "desc", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StageEventFieldResolver.prototype, "time", null);
exports.StageEventFieldResolver = StageEventFieldResolver = __decorate([
    (0, graphql_1.Resolver)('StageEvent')
], StageEventFieldResolver);
let OnebridgeContentFieldResolver = class OnebridgeContentFieldResolver {
    title(entry, locale = 'ko') {
        if (locale === 'zh')
            return entry.titleCn || entry.titleKr || '';
        return entry.titleKr || '';
    }
    body(entry, locale = 'ko') {
        var _a, _b, _c;
        if (locale === 'zh')
            return (_b = (_a = entry.bodyCn) !== null && _a !== void 0 ? _a : entry.bodyKr) !== null && _b !== void 0 ? _b : null;
        return (_c = entry.bodyKr) !== null && _c !== void 0 ? _c : null;
    }
    // ===== C 端字段别名（CT-09 columns/cases/logisticsChannels）=====
    type(entry) {
        return entry.contentType;
    }
    krTitle(entry) {
        var _a;
        return (_a = entry.titleKr) !== null && _a !== void 0 ? _a : '';
    }
    cnTitle(entry) {
        var _a;
        return (_a = entry.titleCn) !== null && _a !== void 0 ? _a : null;
    }
    en(entry) {
        var _a;
        return (_a = entry.titleEn) !== null && _a !== void 0 ? _a : null;
    }
    points(entry) {
        var _a, _b;
        return (_b = (_a = entry.payload) === null || _a === void 0 ? void 0 : _a.points) !== null && _b !== void 0 ? _b : null;
    }
};
exports.OnebridgeContentFieldResolver = OnebridgeContentFieldResolver;
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __param(1, (0, graphql_1.Args)('locale')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeContentFieldResolver.prototype, "title", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __param(1, (0, graphql_1.Args)('locale')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeContentFieldResolver.prototype, "body", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnebridgeContentFieldResolver.prototype, "type", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnebridgeContentFieldResolver.prototype, "krTitle", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnebridgeContentFieldResolver.prototype, "cnTitle", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnebridgeContentFieldResolver.prototype, "en", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnebridgeContentFieldResolver.prototype, "points", null);
exports.OnebridgeContentFieldResolver = OnebridgeContentFieldResolver = __decorate([
    (0, graphql_1.Resolver)('OnebridgeContent')
], OnebridgeContentFieldResolver);
let ServiceChannelFieldResolver = class ServiceChannelFieldResolver {
    // C 端 serviceChannels 查询字段名（CT-09）→ 频道 struct list 字段别名
    key(item) {
        var _a, _b;
        return (_b = (_a = item.key) !== null && _a !== void 0 ? _a : item.needType) !== null && _b !== void 0 ? _b : null;
    }
    no(item) {
        var _a;
        return (_a = item.no) !== null && _a !== void 0 ? _a : null;
    }
    kr(item) {
        var _a;
        return (_a = item.nameKr) !== null && _a !== void 0 ? _a : null;
    }
    cn(item) {
        var _a;
        return (_a = item.nameCn) !== null && _a !== void 0 ? _a : null;
    }
    en(item) {
        var _a;
        return (_a = item.nameEn) !== null && _a !== void 0 ? _a : null;
    }
    headline(item) {
        var _a;
        return (_a = item.headlineKr) !== null && _a !== void 0 ? _a : null;
    }
    intro(item) {
        var _a;
        return (_a = item.introKr) !== null && _a !== void 0 ? _a : null;
    }
};
exports.ServiceChannelFieldResolver = ServiceChannelFieldResolver;
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceChannelFieldResolver.prototype, "key", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceChannelFieldResolver.prototype, "no", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceChannelFieldResolver.prototype, "kr", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceChannelFieldResolver.prototype, "cn", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceChannelFieldResolver.prototype, "en", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceChannelFieldResolver.prototype, "headline", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceChannelFieldResolver.prototype, "intro", null);
exports.ServiceChannelFieldResolver = ServiceChannelFieldResolver = __decorate([
    (0, graphql_1.Resolver)('ServiceChannel')
], ServiceChannelFieldResolver);
/** 清关记录：C 端字段别名 + 时间轴（admin 列表同用） */
let CustomsRecordFieldResolver = class CustomsRecordFieldResolver {
    constructor(orderSummaryService) {
        this.orderSummaryService = orderSummaryService;
    }
    customsDeclaredAt(record) {
        var _a;
        return (_a = record.declaredAt) !== null && _a !== void 0 ? _a : null;
    }
    customsClearedAt(record) {
        var _a;
        return (_a = record.clearedAt) !== null && _a !== void 0 ? _a : null;
    }
    customsNote(record) {
        var _a;
        return (_a = record.note) !== null && _a !== void 0 ? _a : null;
    }
    customsDocs(record) {
        var _a;
        return (_a = record.docs) !== null && _a !== void 0 ? _a : null;
    }
    timeline(record, ctx) {
        return this.orderSummaryService.timeline(ctx, record.orderCode);
    }
};
exports.CustomsRecordFieldResolver = CustomsRecordFieldResolver;
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CustomsRecordFieldResolver.prototype, "customsDeclaredAt", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CustomsRecordFieldResolver.prototype, "customsClearedAt", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CustomsRecordFieldResolver.prototype, "customsNote", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CustomsRecordFieldResolver.prototype, "customsDocs", null);
__decorate([
    (0, graphql_1.ResolveField)(),
    __param(0, (0, graphql_1.Parent)()),
    __param(1, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CustomsRecordFieldResolver.prototype, "timeline", null);
exports.CustomsRecordFieldResolver = CustomsRecordFieldResolver = __decorate([
    (0, graphql_1.Resolver)('CustomsRecord'),
    __metadata("design:paramtypes", [services_1.OnebridgeOrderSummaryService])
], CustomsRecordFieldResolver);
let OnebridgeShopResolver = class OnebridgeShopResolver {
    constructor(rfqService, contentService, inspectionService, customsService, orderSummaryService, specSheetService) {
        this.rfqService = rfqService;
        this.contentService = contentService;
        this.inspectionService = inspectionService;
        this.customsService = customsService;
        this.orderSummaryService = orderSummaryService;
        this.specSheetService = specSheetService;
    }
    submitRfq(ctx, input) {
        return this.rfqService.submitRfq(ctx, input);
    }
    myRfqs(ctx, options) {
        return this.rfqService.myRfqs(ctx, options);
    }
    rfq(ctx, code) {
        return this.rfqService.findRfqForCustomer(ctx, code);
    }
    columns(ctx, options) {
        return this.contentService.shopList(ctx, 'column', options);
    }
    column(ctx, slug) {
        return this.contentService.shopFindBySlug(ctx, 'column', slug);
    }
    cases(ctx, options) {
        return this.contentService.shopList(ctx, 'case', options);
    }
    case(ctx, slug) {
        return this.contentService.shopFindBySlug(ctx, 'case', slug);
    }
    logisticsChannels(ctx, options) {
        return this.contentService.shopList(ctx, 'logistics_channel', options);
    }
    logisticsChannel(ctx, slug) {
        return this.contentService.shopFindBySlug(ctx, 'logistics_channel', slug);
    }
    siteContent(ctx, options) {
        return this.contentService.shopList(ctx, 'site_block', options);
    }
    siteContentBundle(ctx, options) {
        return this.contentService.shopBundle(ctx, options);
    }
    serviceChannels(ctx) {
        return this.contentService.serviceChannels(ctx);
    }
    specSheets(ctx, take) {
        return this.specSheetService.list(ctx, { take });
    }
    inspectionReports(ctx, args) {
        return this.inspectionService.shopList(ctx, args);
    }
    orderCustoms(ctx, orderCode) {
        return this.customsService.shopFind(ctx, orderCode);
    }
    async orderTimeline(ctx, orderCode) {
        const summary = await this.orderSummaryService.summary(ctx, orderCode, true);
        return summary.timeline;
    }
    orderTracks(ctx, orderCode) {
        return this.orderSummaryService.orderTracks(ctx, orderCode);
    }
    orderSummary(ctx, orderCode) {
        return this.orderSummaryService.summary(ctx, orderCode, true);
    }
};
exports.OnebridgeShopResolver = OnebridgeShopResolver;
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "submitRfq", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "myRfqs", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "rfq", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "columns", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "column", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "cases", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "case", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "logisticsChannels", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "logisticsChannel", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "siteContent", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "siteContentBundle", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "serviceChannels", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "specSheets", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "inspectionReports", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "orderCustoms", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], OnebridgeShopResolver.prototype, "orderTimeline", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "orderTracks", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeShopResolver.prototype, "orderSummary", null);
exports.OnebridgeShopResolver = OnebridgeShopResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [services_1.OnebridgeRfqService,
        services_1.OnebridgeContentService,
        services_1.OnebridgeInspectionService,
        services_1.OnebridgeCustomsService,
        services_1.OnebridgeOrderSummaryService,
        services_1.OnebridgeSpecSheetService])
], OnebridgeShopResolver);
//# sourceMappingURL=shop.resolver.js.map