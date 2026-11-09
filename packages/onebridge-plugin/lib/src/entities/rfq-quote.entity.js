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
exports.RfqQuote = void 0;
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
/** RFQ 报价（CT-02 RfqQuote）：一次有效报价，金额按 CT-00 以最小单位整数传输 */
let RfqQuote = class RfqQuote extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.RfqQuote = RfqQuote;
__decorate([
    (0, typeorm_1.Index)({ unique: true }),
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], RfqQuote.prototype, "rfqId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], RfqQuote.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 4 }),
    __metadata("design:type", String)
], RfqQuote.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", Date)
], RfqQuote.prototype, "validUntil", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], RfqQuote.prototype, "note", void 0);
exports.RfqQuote = RfqQuote = __decorate([
    (0, typeorm_1.Entity)('onebridge_rfq_quote'),
    __metadata("design:paramtypes", [Object])
], RfqQuote);
//# sourceMappingURL=rfq-quote.entity.js.map