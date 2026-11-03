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
exports.LogisticsApiAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const logistics_query_service_1 = require("./logistics-query.service");
let LogisticsApiAdminResolver = class LogisticsApiAdminResolver {
    constructor(logisticsQueryService) {
        this.logisticsQueryService = logisticsQueryService;
    }
    async logisticsTracking(ctx, carrierCode, trackingNumber) {
        const result = await this.logisticsQueryService.queryTracking(ctx, carrierCode, trackingNumber);
        return result;
    }
    async detectCarrier(ctx, trackingNumber) {
        return this.logisticsQueryService.detectCarrier(ctx, trackingNumber);
    }
};
exports.LogisticsApiAdminResolver = LogisticsApiAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('carrierCode')),
    __param(2, (0, graphql_1.Args)('trackingNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String]),
    __metadata("design:returntype", Promise)
], LogisticsApiAdminResolver.prototype, "logisticsTracking", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('trackingNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], LogisticsApiAdminResolver.prototype, "detectCarrier", null);
exports.LogisticsApiAdminResolver = LogisticsApiAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [logistics_query_service_1.LogisticsQueryService])
], LogisticsApiAdminResolver);
