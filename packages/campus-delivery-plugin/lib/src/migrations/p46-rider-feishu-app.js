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
exports.P46RiderFeishuAppMigration = exports.p46RiderFeishuAppSql = void 0;
// 骑手飞书抢单 B 方案（2026-11-09）：open_id 是应用维度标识，必须与骑手独立应用 appId 一起匹配。
// 自定义字段是物理列（customFields + 首字母大写+其余小写），生产 DB_SYNC=0 时靠此处幂等补列。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p46RiderFeishuAppSql = `
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuappid" varchar(255)
`;
let P46RiderFeishuAppMigration = class P46RiderFeishuAppMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of exports.p46RiderFeishuAppSql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[P46RiderFeishuAppMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P46RiderFeishuAppMigration = P46RiderFeishuAppMigration;
exports.P46RiderFeishuAppMigration = P46RiderFeishuAppMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P46RiderFeishuAppMigration);
//# sourceMappingURL=p46-rider-feishu-app.js.map