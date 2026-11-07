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
exports.SubscriptionOccurrence = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/** 期次：第 1..N 期。状态机 pending → orderCreated | skipped | cancelled。幂等：subscriptionId×periodNo 唯一。 */
let SubscriptionOccurrence = class SubscriptionOccurrence extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.SubscriptionOccurrence = SubscriptionOccurrence;
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], SubscriptionOccurrence.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], SubscriptionOccurrence.prototype, "subscriptionId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], SubscriptionOccurrence.prototype, "periodNo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], SubscriptionOccurrence.prototype, "scheduledDate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Array)
], SubscriptionOccurrence.prototype, "sellerItemsJson", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], SubscriptionOccurrence.prototype, "generatedOrderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], SubscriptionOccurrence.prototype, "orderCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], SubscriptionOccurrence.prototype, "skipReason", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'pending' }),
    __metadata("design:type", String)
], SubscriptionOccurrence.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => core_1.Channel),
    (0, typeorm_1.JoinTable)(),
    __metadata("design:type", Array)
], SubscriptionOccurrence.prototype, "channels", void 0);
exports.SubscriptionOccurrence = SubscriptionOccurrence = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Index)(['subscriptionId', 'periodNo'], { unique: true }),
    __metadata("design:paramtypes", [Object])
], SubscriptionOccurrence);
//# sourceMappingURL=subscription-occurrence.entity.js.map