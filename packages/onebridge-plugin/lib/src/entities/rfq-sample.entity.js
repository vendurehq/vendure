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
exports.RfqSample = void 0;
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
/** RFQ 样品记录（CT-02 RfqSample） */
let RfqSample = class RfqSample extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.RfqSample = RfqSample;
__decorate([
    (0, typeorm_1.Index)({ unique: true }),
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], RfqSample.prototype, "rfqId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 32 }),
    __metadata("design:type", String)
], RfqSample.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64, nullable: true }),
    __metadata("design:type", Object)
], RfqSample.prototype, "trackingNo", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", Date)
], RfqSample.prototype, "confirmedAt", void 0);
exports.RfqSample = RfqSample = __decorate([
    (0, typeorm_1.Entity)('onebridge_rfq_sample'),
    __metadata("design:paramtypes", [Object])
], RfqSample);
//# sourceMappingURL=rfq-sample.entity.js.map