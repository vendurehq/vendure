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
exports.ReconciliationOrderLine = exports.ReconciliationBatch = void 0;
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
let ReconciliationBatch = class ReconciliationBatch extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.ReconciliationBatch = ReconciliationBatch;
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", Object)
], ReconciliationBatch.prototype, "tenantChannelId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], ReconciliationBatch.prototype, "date", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'running' }),
    __metadata("design:type", String)
], ReconciliationBatch.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], ReconciliationBatch.prototype, "d1Count", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], ReconciliationBatch.prototype, "d2Count", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], ReconciliationBatch.prototype, "d3Count", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], ReconciliationBatch.prototype, "d4Count", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], ReconciliationBatch.prototype, "orderTotal", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'manual' }),
    __metadata("design:type", String)
], ReconciliationBatch.prototype, "trigger", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], ReconciliationBatch.prototype, "startedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], ReconciliationBatch.prototype, "finishedAt", void 0);
exports.ReconciliationBatch = ReconciliationBatch = __decorate([
    (0, typeorm_1.Entity)(),
    __metadata("design:paramtypes", [Object])
], ReconciliationBatch);
let ReconciliationOrderLine = class ReconciliationOrderLine extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.ReconciliationOrderLine = ReconciliationOrderLine;
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", Object)
], ReconciliationOrderLine.prototype, "batchId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", Object)
], ReconciliationOrderLine.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], ReconciliationOrderLine.prototype, "diffTypes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'pending' }),
    __metadata("design:type", String)
], ReconciliationOrderLine.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], ReconciliationOrderLine.prototype, "remark", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], ReconciliationOrderLine.prototype, "fixedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], ReconciliationOrderLine.prototype, "fixerId", void 0);
exports.ReconciliationOrderLine = ReconciliationOrderLine = __decorate([
    (0, typeorm_1.Entity)(),
    __metadata("design:paramtypes", [Object])
], ReconciliationOrderLine);
//# sourceMappingURL=reconciliation.entity.js.map