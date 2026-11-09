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
// 骑手飞书抢单 B 方案（2026-11-09）：
// 1) open_id 是应用维度标识，必须与骑手独立应用 appId 一起匹配 → 新增 riderFeishuAppId 物理列。
// 2) p43 曾用裸 timestamp 建 boundAt；若目标库已按旧迁移落成 timestamp without time zone，
//    这里幂等转成 timestamptz（TypeORM 写入的是 UTC 瞬时值，故按 UTC 解释）。
// 迁移必须幂等：建列 IF NOT EXISTS，类型转换先查 information_schema。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p46RiderFeishuAppSql = `
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuappid" varchar(255);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customer'
          AND column_name = 'customFieldsRiderfeishuboundat'
          -- 无时区的时间列（含 history）：排除 timestamptz，避免触碰已正确的库
          AND data_type LIKE 'time%'
          AND data_type NOT LIKE '%with time zone'
    ) THEN
        ALTER TABLE "customer"
            ALTER COLUMN "customFieldsRiderfeishuboundat" TYPE timestamptz
            USING "customFieldsRiderfeishuboundat" AT TIME ZONE 'UTC';
    END IF;
END $$;
`;
let P46RiderFeishuAppMigration = class P46RiderFeishuAppMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                // 含 DO $$ 块，不能按分号拆分，整段交给 pg 执行
                await qr.query(exports.p46RiderFeishuAppSql);
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