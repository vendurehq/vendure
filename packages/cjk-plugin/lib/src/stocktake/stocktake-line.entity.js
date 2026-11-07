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
exports.StocktakeLine = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/**
 * 应盘行（规格 §4.3）。
 * 注意：`bookQty` 是「该变体在该仓」的账面快照，**仅供行内提示**，
 * 差异一律按变体汇总计算（R11），禁止逐行相减。
 * 唯一约束里 `binId` 可空 → postgres 中 NULL 互不相等，故「未归位桶」允许同变体多行（符合预期）。
 */
let StocktakeLine = class StocktakeLine extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.StocktakeLine = StocktakeLine;
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], StocktakeLine.prototype, "tenantChannelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], StocktakeLine.prototype, "taskId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], StocktakeLine.prototype, "waveId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], StocktakeLine.prototype, "variantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], StocktakeLine.prototype, "variantSku", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], StocktakeLine.prototype, "variantName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "zoneId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "binId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "zoneCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "binCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], StocktakeLine.prototype, "bookQty", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "countedQty", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], StocktakeLine.prototype, "isExtra", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "countedById", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "countedByName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "countedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], StocktakeLine.prototype, "note", void 0);
exports.StocktakeLine = StocktakeLine = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Unique)(['taskId', 'waveId', 'variantId', 'binId']),
    (0, typeorm_1.Index)(['taskId', 'waveId']),
    (0, typeorm_1.Index)(['waveId', 'countedQty']),
    (0, typeorm_1.Index)(['taskId', 'variantId']),
    __metadata("design:paramtypes", [Object])
], StocktakeLine);
//# sourceMappingURL=stocktake-line.entity.js.map