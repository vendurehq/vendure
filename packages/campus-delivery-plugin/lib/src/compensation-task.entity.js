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
exports.CampusCompensationTask = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/**
 * 补偿任务（R2）：券/站内信等旁路动作失败后落库，由定时任务退避重试。
 * 主流程（退款/取消）永远不因补偿失败而回滚；本表只负责「最终一致」。
 */
let CampusCompensationTask = class CampusCompensationTask extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.CampusCompensationTask = CampusCompensationTask;
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusCompensationTask.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusCompensationTask.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusCompensationTask.prototype, "customerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], CampusCompensationTask.prototype, "kind", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CampusCompensationTask.prototype, "payload", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], CampusCompensationTask.prototype, "dedupeKey", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'pending' }),
    __metadata("design:type", String)
], CampusCompensationTask.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], CampusCompensationTask.prototype, "attempts", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], CampusCompensationTask.prototype, "nextAttemptAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusCompensationTask.prototype, "lastError", void 0);
exports.CampusCompensationTask = CampusCompensationTask = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Index)(['status', 'nextAttemptAt']),
    (0, typeorm_1.Index)(['dedupeKey'], { unique: true }),
    __metadata("design:paramtypes", [Object])
], CampusCompensationTask);
//# sourceMappingURL=compensation-task.entity.js.map