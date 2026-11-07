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
exports.PickBatchOrder = void 0;
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
const pick_batch_entity_1 = require("./pick-batch.entity");
let PickBatchOrder = class PickBatchOrder extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.PickBatchOrder = PickBatchOrder;
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'integer' }),
    __metadata("design:type", Number)
], PickBatchOrder.prototype, "batchId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => pick_batch_entity_1.PickBatch, (b) => b.orders, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'batchId' }),
    __metadata("design:type", pick_batch_entity_1.PickBatch)
], PickBatchOrder.prototype, "batch", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'integer' }),
    __metadata("design:type", Number)
], PickBatchOrder.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], PickBatchOrder.prototype, "addedAt", void 0);
exports.PickBatchOrder = PickBatchOrder = __decorate([
    (0, typeorm_1.Entity)('pick_batch_order'),
    (0, typeorm_1.Unique)(['batchId', 'orderId']),
    __metadata("design:paramtypes", [Object])
], PickBatchOrder);
//# sourceMappingURL=pick-batch-order.entity.js.map