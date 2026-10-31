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
exports.CampusFulfillmentConfig = exports.TRUST_TEXT_MAX_LENGTH = exports.STORE_NOTICE_MAX_LENGTH = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/** 店铺公告最大长度（列宽与应用层校验共用，避免「能填不能存」） */
exports.STORE_NOTICE_MAX_LENGTH = 500;
/** 信任文案单条最大长度（§113）：评价页信任签名卡三行自定义文案 */
exports.TRUST_TEXT_MAX_LENGTH = 80;
let CampusFulfillmentConfig = class CampusFulfillmentConfig extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.CampusFulfillmentConfig = CampusFulfillmentConfig;
__decorate([
    (0, typeorm_1.Column)('int', { unique: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', default: '["R1","R3","R4","R5"]' }),
    __metadata("design:type", Array)
], CampusFulfillmentConfig.prototype, "routesEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 100 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "riderCommissionRate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 10 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "autoAssignMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "paused", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 30 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "autoRefundMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 45 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "inProgressSlaMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], CampusFulfillmentConfig.prototype, "compensationCouponTemplateId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "deliveryMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "minOrderAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "deliveryFee", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "storeAddress", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "storePhone", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: exports.STORE_NOTICE_MAX_LENGTH, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "storeNotice", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "errandBaseFee", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "thirdPartyBaseFee", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "freeShippingThreshold", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "deliveryFeeTiers", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "merchantConfirmEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 15 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "merchantAutoOpenMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "autoAcceptEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 30 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "autoAcceptDelaySeconds", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "autoAcceptDailyLimit", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', default: '["R1","R2","R3"]' }),
    __metadata("design:type", Array)
], CampusFulfillmentConfig.prototype, "autoAcceptRoutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "closureDates", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "timeoutCompensationEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 10 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "timeoutGraceMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 24 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "timeoutCompensationWindowHours", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "timeoutCompensationCouponTemplateId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateAccepted", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateRiderAssigned", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateCookingDone", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateDelivered", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateExceptionHandled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateArrivedHandover", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateDeliveryFallback", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateOrderPlaced", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplatePaymentPending", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateCancelled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateAfterSales", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "notifyTemplateAddressChanged", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "h5BaseUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "printMode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'local' }),
    __metadata("design:type", String)
], CampusFulfillmentConfig.prototype, "printProvider", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "printAccount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "printDeviceSn", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 128, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "printDeviceKey", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "printCopies", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "routeFirstLeg", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "handoverPoints", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "providerShopNo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 5 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "merchantAcceptMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 10 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "externalPushTimeoutMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 20 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "externalFallbackMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'float' }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "storeLat", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'float' }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "storeLng", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "dynamicPricing", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "shiftCheckEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "blacklistAutoCancelCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "privacyNumberEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'mask' }),
    __metadata("design:type", String)
], CampusFulfillmentConfig.prototype, "privacyNumberProvider", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 60 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "privacyNumberTtlMinutes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "privacyNumberPrefix", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "foodLicenseNo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "foodLicenseImage", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "foodLicenseExpiry", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "foodSafetyGrade", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "foodSafetyCommitmentImage", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "kitchenLiveUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "kitchenLiveEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "packingFeeEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'perItem' }),
    __metadata("design:type", String)
], CampusFulfillmentConfig.prototype, "packingFeeMode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], CampusFulfillmentConfig.prototype, "packingFeeAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "packingFeeCap", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "packingFeeLabel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "mpAppId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "mpCategory", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 32, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "mpVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'draft' }),
    __metadata("design:type", String)
], CampusFulfillmentConfig.prototype, "mpListingStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "mpPrivacyUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 500, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "mpReviewNote", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'mock' }),
    __metadata("design:type", String)
], CampusFulfillmentConfig.prototype, "voiceSearchProvider", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'mock' }),
    __metadata("design:type", String)
], CampusFulfillmentConfig.prototype, "imageSearchProvider", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "trustQualityEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: exports.TRUST_TEXT_MAX_LENGTH, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "trustQualityText", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "trustServiceEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: exports.TRUST_TEXT_MAX_LENGTH, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "trustServiceText", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "trustTimeEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: exports.TRUST_TEXT_MAX_LENGTH, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "trustTimeText", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], CampusFulfillmentConfig.prototype, "unmannedDeliveryEnabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'mock' }),
    __metadata("design:type", String)
], CampusFulfillmentConfig.prototype, "unmannedDeliveryProvider", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "unmannedDeliveryEndpoint", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 128, nullable: true }),
    __metadata("design:type", Object)
], CampusFulfillmentConfig.prototype, "unmannedDeliveryKey", void 0);
exports.CampusFulfillmentConfig = CampusFulfillmentConfig = __decorate([
    (0, typeorm_1.Entity)(),
    __metadata("design:paramtypes", [Object])
], CampusFulfillmentConfig);
//# sourceMappingURL=campus-fulfillment-config.entity.js.map