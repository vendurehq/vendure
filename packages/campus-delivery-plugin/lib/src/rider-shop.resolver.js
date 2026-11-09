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
exports.RiderShopResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const capacity_service_1 = require("./capacity.service");
const campus_config_service_1 = require("./campus-config.service");
const rider_service_1 = require("./rider.service");
const rider_wallet_service_1 = require("./rider-wallet.service");
const shipping_calculator_1 = require("./shipping-calculator");
let RiderShopResolver = class RiderShopResolver {
    constructor(riderService, configService, capacity, wallet, connection) {
        this.riderService = riderService;
        this.configService = configService;
        this.capacity = capacity;
        this.wallet = wallet;
        this.connection = connection;
    }
    /** 需登录：service 内部校验当前顾客，未登录抛 ForbiddenError。 */
    async applyRider(ctx, realName, studentNo, campus, idImg, healthCertImg) {
        return this.riderService.applyRider(ctx, { realName, studentNo, campus, idImg, healthCertImg });
    }
    async myRiderProfile(ctx) {
        return this.riderService.myRiderProfile(ctx);
    }
    /** 骑手钱包：可用余额 / 冻结中 / 累计收入 */
    async myRiderWallet(ctx) {
        return this.wallet.myRiderWallet(ctx);
    }
    /** 余额流水（含分成入账/充值/消费/提现冻结/退回） */
    async riderBalanceHistory(ctx, skip, take) {
        return this.wallet.riderBalanceHistory(ctx, skip, take);
    }
    /** 本人提现申请记录 */
    async riderWithdrawRequests(ctx, skip, take) {
        return this.wallet.riderWithdrawRequests(ctx, skip, take);
    }
    /** 提现申请：金额（分）+ 收款渠道 + 账号，提交即冻结 */
    async riderWithdraw(ctx, amount, channel, account) {
        return this.wallet.riderWithdraw(ctx, { amount, channel, account });
    }
    /** 骑手上下线开关（大厅轮询页 15s 轮询续命） */
    async campusRiderOnline(ctx, online) {
        return this.riderService.setOnline(ctx, online);
    }
    /** 骑手心跳（30s 定时调），带骑手资格校验 */
    async campusRiderHeartbeat(ctx) {
        return this.capacity.heartbeat(ctx);
    }
    /** T0 运力预检：C 端下单前提示「运力紧张」（公开只读，无需登录） */
    async campusCapacityCheck(ctx) {
        return this.capacity.capacityCheck(ctx);
    }
    // 公开只读：C 端选楼用（分区带实时报价：price/addFee/breakdown，与结算同口径）
    async campusZones(ctx) {
        const zones = await this.configService.listZones(ctx);
        return (0, shipping_calculator_1.quoteZonesForShop)(this.connection, ctx.channelId, zones);
    }
    async campusBuildings(ctx, zoneId) {
        const buildings = await this.configService.listBuildings(ctx, zoneId != null ? Number(zoneId) : undefined);
        // 楼栋经纬度可能为 NULL（历史数据未标点）：只下发布尔标记，避免 C 端拿到坐标缺失时误以为能送到楼下
        return buildings.map((b) => (Object.assign(Object.assign({}, b), { hasCoords: b.lat != null && b.lng != null })));
    }
};
exports.RiderShopResolver = RiderShopResolver;
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('realName')),
    __param(2, (0, graphql_1.Args)('studentNo')),
    __param(3, (0, graphql_1.Args)('campus')),
    __param(4, (0, graphql_1.Args)('idImg', { nullable: true })),
    __param(5, (0, graphql_1.Args)('healthCertImg', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "applyRider", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "myRiderProfile", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "myRiderWallet", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('skip', { nullable: true })),
    __param(2, (0, graphql_1.Args)('take', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Number, Number]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "riderBalanceHistory", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('skip', { nullable: true })),
    __param(2, (0, graphql_1.Args)('take', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Number, Number]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "riderWithdrawRequests", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('amount')),
    __param(2, (0, graphql_1.Args)('channel')),
    __param(3, (0, graphql_1.Args)('account')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Number, String, String]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "riderWithdraw", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('online')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Boolean]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "campusRiderOnline", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "campusRiderHeartbeat", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "campusCapacityCheck", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "campusZones", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'zoneId', nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RiderShopResolver.prototype, "campusBuildings", null);
exports.RiderShopResolver = RiderShopResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [rider_service_1.RiderService,
        campus_config_service_1.CampusConfigService,
        capacity_service_1.CapacityService,
        rider_wallet_service_1.RiderWalletService,
        core_1.TransactionalConnection])
], RiderShopResolver);
//# sourceMappingURL=rider-shop.resolver.js.map