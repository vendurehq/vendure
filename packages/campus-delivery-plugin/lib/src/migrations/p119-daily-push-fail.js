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
exports.P119DailyPushFailMigration = exports.p119DailyPushFailSql = void 0;
// §119 日报推送失败原因可见（2026-11-01）。
// 生产 synchronize: false，启动幂等补列（IF NOT EXISTS，重复启动安全）。
// 只加两列，不动既有列；列名遵循 Vendure 自定义字段规则（全小写）。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p119DailyPushFailSql = `
ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "customFieldsWaimaidailypushlastfailat" varchar(16);
ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "customFieldsWaimaidailypushlastfailreason" varchar(200);
`;
let P119DailyPushFailMigration = class P119DailyPushFailMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of exports.p119DailyPushFailSql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            console.error('[P119DailyPushFailMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P119DailyPushFailMigration = P119DailyPushFailMigration;
exports.P119DailyPushFailMigration = P119DailyPushFailMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P119DailyPushFailMigration);
//# sourceMappingURL=p119-daily-push-fail.js.map