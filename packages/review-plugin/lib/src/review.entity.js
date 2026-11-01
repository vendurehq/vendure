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
exports.Review = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
let Review = class Review extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.Review = Review;
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Number)
], Review.prototype, "customerId", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Number)
], Review.prototype, "productId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "orderLineId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "variantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], Review.prototype, "rating", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], Review.prototype, "content", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "images", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "videos", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "tags", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], Review.prototype, "isAnonymous", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'pending' }),
    __metadata("design:type", String)
], Review.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "reply", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", Date)
], Review.prototype, "repliedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 0 }),
    __metadata("design:type", Number)
], Review.prototype, "helpfulCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], Review.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => core_1.Channel),
    (0, typeorm_1.JoinTable)(),
    __metadata("design:type", Array)
], Review.prototype, "channels", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "parentId", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], Review.prototype, "giftGranted", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "giftChoice", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "reviewedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "appealStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "appealReason", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "appealImages", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "appealAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "appealResult", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "appealReviewedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], Review.prototype, "appealReviewedAt", void 0);
exports.Review = Review = __decorate([
    (0, typeorm_1.Entity)(),
    __metadata("design:paramtypes", [Object])
], Review);
//# sourceMappingURL=review.entity.js.map