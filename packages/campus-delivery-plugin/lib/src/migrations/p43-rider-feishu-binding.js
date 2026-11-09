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
exports.P43RiderFeishuBindingMigration = exports.p43RiderFeishuBindingSql = void 0;
// 骑手群飞书抢单（2026-11-09）：Customer 飞书 open_id 绑定列。
// 与 p9-p5-rider-compliance 同模式：自定义字段是物理列（customFields + 首字母大写+其余小写），
// 生产 DB_SYNC=0 关闭同步时靠此处幂等补列；IF NOT EXISTS 重复启动安全。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p43RiderFeishuBindingSql = `
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuopenid" varchar(255);
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuboundat" timestamp
`;
let P43RiderFeishuBindingMigration = class P43RiderFeishuBindingMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of exports.p43RiderFeishuBindingSql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[P43RiderFeishuBindingMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P43RiderFeishuBindingMigration = P43RiderFeishuBindingMigration;
exports.P43RiderFeishuBindingMigration = P43RiderFeishuBindingMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P43RiderFeishuBindingMigration);
//# sourceMappingURL=p43-rider-feishu-binding.js.map