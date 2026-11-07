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
exports.StocktakeTask = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/**
 * 盘库任务：一个任务 = 一个仓库；多仓协同靠 activityCode 分组，各仓独立过账（规格 §3.3）。
 */
let StocktakeTask = class StocktakeTask extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.StocktakeTask = StocktakeTask;
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], StocktakeTask.prototype, "code", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], StocktakeTask.prototype, "tenantChannelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], StocktakeTask.prototype, "stockLocationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], StocktakeTask.prototype, "activityCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], StocktakeTask.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], StocktakeTask.prototype, "scopeJson", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], StocktakeTask.prototype, "binModeAtCreate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], StocktakeTask.prototype, "state", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], StocktakeTask.prototype, "createdById", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], StocktakeTask.prototype, "createdByName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], StocktakeTask.prototype, "postedStockDocId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], StocktakeTask.prototype, "postedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], StocktakeTask.prototype, "note", void 0);
exports.StocktakeTask = StocktakeTask = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Unique)(['tenantChannelId', 'code']),
    (0, typeorm_1.Index)(['tenantChannelId', 'state']),
    (0, typeorm_1.Index)(['tenantChannelId', 'activityCode'])
    // 单据中心按 postedStockDocId 反查任务号（D44）：复合索引，避免单据列表每页全表扫
    ,
    (0, typeorm_1.Index)(['tenantChannelId', 'postedStockDocId']),
    __metadata("design:paramtypes", [Object])
], StocktakeTask);
//# sourceMappingURL=stocktake-task.entity.js.map