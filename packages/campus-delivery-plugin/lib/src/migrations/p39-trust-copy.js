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
exports.P39TrustCopyMigration = exports.p39TrustCopySql = void 0;
// §113（2026-11-01）：信任文案店铺级配置 6 列（质量/服务/时间 开关 + 自定义文案）。
// 生产 synchronize:false，新增字段必须落物理列，否则配置查询直接报 column does not exist。
// 迁移幂等（IF NOT EXISTS + 默认值），随服务启动执行。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p39TrustCopySql = `
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustQualityEnabled" boolean DEFAULT true;
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustQualityText" varchar(80);
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustServiceEnabled" boolean DEFAULT true;
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustServiceText" varchar(80);
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustTimeEnabled" boolean DEFAULT true;
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustTimeText" varchar(80);
`;
let P39TrustCopyMigration = class P39TrustCopyMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of exports.p39TrustCopySql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[P39TrustCopyMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P39TrustCopyMigration = P39TrustCopyMigration;
exports.P39TrustCopyMigration = P39TrustCopyMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P39TrustCopyMigration);
//# sourceMappingURL=p39-trust-copy.js.map