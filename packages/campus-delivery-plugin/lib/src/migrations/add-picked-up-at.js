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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddPickedUpAtMigration = exports.addPickedUpAtSql = void 0;
// 已取餐时间锚点（2026-11-07）：自营快递/骑手确认取餐写 pickedUpAt，在途时钟只认它。
// 生产 PostgreSQL 可能关闭 synchronize，故启动时补列；IF NOT EXISTS 幂等，重复启动无副作用。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.addPickedUpAtSql = `
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "customFieldsPickedupat" timestamp with time zone;
`;
let AddPickedUpAtMigration = class AddPickedUpAtMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const queryRunner = this.connection.createQueryRunner();
            try {
                await queryRunner.query(exports.addPickedUpAtSql);
            }
            finally {
                await queryRunner.release();
            }
        }
        catch (e) {
            // 表尚未建立（首次安装先跑建表）等情况只打日志，等待下次启动重试
            // eslint-disable-next-line no-console
            console.error('[AddPickedUpAtMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.AddPickedUpAtMigration = AddPickedUpAtMigration;
exports.AddPickedUpAtMigration = AddPickedUpAtMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], AddPickedUpAtMigration);
//# sourceMappingURL=add-picked-up-at.js.map