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
exports.RiderTaskShopResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const r2_mark_service_1 = require("./r2-mark.service");
const hall_service_1 = require("./hall.service");
const rider_task_service_1 = require("./rider-task.service");
let RiderTaskShopResolver = class RiderTaskShopResolver {
    constructor(riderTaskService, r2Mark, hall) {
        this.riderTaskService = riderTaskService;
        this.r2Mark = r2Mark;
        this.hall = hall;
    }
    /** 需登录骑手：service 内部 assertApprovedRider，未登录/未批准/信用分不足抛 ForbiddenError。 */
    async campusMyTasks(ctx, status) {
        return this.riderTaskService.myTasks(ctx, status);
    }
    /** 骑手侧顾客联系方式（号码保护）：仅本单骑手可查，返回 display/callable 而非真实号 */
    async campusRiderCustomerContact(ctx, orderId) {
        return this.riderTaskService.customerContact(ctx, orderId);
    }
    /** 需登录：仅下单人本人可查（service 内归属校验） */
    async campusOrderRider(ctx, orderId) {
        return this.riderTaskService.orderRider(ctx, orderId);
    }
    /** 交接码：仅本单骑手可查（R1/R2 第二段起送必填），未指派/已送达返回 null */
    async campusTaskHandoverCode(ctx, orderId) {
        return this.riderTaskService.handoverCode(ctx, orderId);
    }
    /** 开始配送：接力单（R1/R2）需传交接码，service 内校验。 */
    async campusStartTask(ctx, orderId, code) {
        return this.riderTaskService.start(ctx, orderId, code);
    }
    /** 转单回大厅；已取货必须拍照交接。错误语义：未登录/非本人 ForbiddenError，状态/缺照片 UserInputError。 */
    async campusTransferTask(ctx, orderId, photos, note) {
        return this.riderTaskService.transfer(ctx, orderId, photos, note);
    }
    async campusDeliverTask(ctx, orderId, photos, note) {
        return this.riderTaskService.deliver(ctx, orderId, photos, note);
    }
    /** 骑手位置上报（配送中 10s 一次）：本人 + assigned/in_progress 才写，送达/转单由 service 清除。 */
    async campusRiderReportLocation(ctx, orderId, lat, lng) {
        return this.riderTaskService.reportLocation(ctx, orderId, lat, lng);
    }
    async campusReportException(ctx, orderId, type, photos, note) {
        return this.riderTaskService.reportException(ctx, orderId, type, photos, note);
    }
    /** R2 快递单到校确认：本人 + fulfillmentRoute='R2'，service 内校验，违规抛 Forbidden/UserInputError。 */
    async campusMarkArrived(ctx, orderId) {
        return this.r2Mark.markArrived(ctx, orderId);
    }
    /** R5 顾客侧重发交接码：订单归属校验在 service，仅待交接订单可重发（同单 10 分钟限流）。 */
    async campusResendHandoverCode(ctx, orderId) {
        return this.hall.resendHandoverCodeForCustomer(ctx, Number(orderId));
    }
    /** A3 骑手侧重发交接码：仅本单骑手、已派单未取餐可重发（同单 3 分钟限频）。 */
    async campusRiderResendHandoverCode(ctx, orderId) {
        return this.riderTaskService.resendHandoverCode(ctx, orderId);
    }
    /** 用户催单（plan 2.4）：状态/频率校验在 service，标记 urged=true + urgedAt。 */
    async campusUrgeOrder(ctx, orderId) {
        return this.riderTaskService.urgeOrder(ctx, orderId);
    }
};
exports.RiderTaskShopResolver = RiderTaskShopResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('status', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusMyTasks", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusRiderCustomerContact", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusOrderRider", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusTaskHandoverCode", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('code', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusStartTask", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('photos')),
    __param(3, (0, graphql_1.Args)('note', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Array, String]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusTransferTask", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('photos')),
    __param(3, (0, graphql_1.Args)('note', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Array, String]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusDeliverTask", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('lat')),
    __param(3, (0, graphql_1.Args)('lng')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Number, Number]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusRiderReportLocation", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('type')),
    __param(3, (0, graphql_1.Args)('photos')),
    __param(4, (0, graphql_1.Args)('note', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, Array, String]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusReportException", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusMarkArrived", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusResendHandoverCode", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusRiderResendHandoverCode", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RiderTaskShopResolver.prototype, "campusUrgeOrder", null);
exports.RiderTaskShopResolver = RiderTaskShopResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [rider_task_service_1.RiderTaskService,
        r2_mark_service_1.R2MarkService,
        hall_service_1.HallService])
], RiderTaskShopResolver);
//# sourceMappingURL=rider-task-shop.resolver.js.map