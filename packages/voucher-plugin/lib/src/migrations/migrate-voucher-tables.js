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
exports.VoucherTablesMigration = void 0;
// 幂等补建券包两张表及其渠道关联表（VoucherPlugin 首次上线）。
// 生产（PostgreSQL）与本地开发（SQLite）都可能关闭 synchronize，故用 IF NOT EXISTS 兜底；
// 列名/类型与 service-voucher.entity.ts、voucher-booking.entity.ts 及 TypeORM 默认命名对齐。
// 建表失败不阻塞启动，等待下次启动重试。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
function isPostgres(driver) {
    return driver === 'postgres' || driver === 'postgresql';
}
let VoucherTablesMigration = class VoucherTablesMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        const queryRunner = this.connection.createQueryRunner();
        try {
            const pg = isPostgres(this.connection.options.type);
            const pk = pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
            const ts = pg ? 'timestamp' : 'datetime';
            const now = pg ? 'now()' : 'CURRENT_TIMESTAMP';
            const Q = (s) => `"${s}"`;
            const base = `${Q('id')} ${pk}, ` +
                `${Q('createdAt')} ${ts} NOT NULL DEFAULT ${now}, ` +
                `${Q('updatedAt')} ${ts} NOT NULL DEFAULT ${now}, ` +
                `${Q('deletedAt')} ${ts} NULL, `;
            await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${Q('service_voucher')} (` +
                base +
                `${Q('channelId')} integer NOT NULL, ` +
                `${Q('orderId')} integer NOT NULL, ` +
                `${Q('customerId')} integer NOT NULL, ` +
                `${Q('shopId')} integer NOT NULL, ` +
                `${Q('productVariantId')} integer NOT NULL, ` +
                `${Q('productVoucherName')} varchar NOT NULL, ` +
                `${Q('code')} varchar NOT NULL, ` +
                `${Q('status')} varchar NOT NULL DEFAULT 'usable', ` +
                `${Q('effectiveDays')} integer NOT NULL, ` +
                `${Q('expiresAt')} ${ts} NULL, ` +
                `${Q('usedAt')} ${ts} NULL, ` +
                `${Q('refundedAt')} ${ts} NULL)`);
            await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${Q('idx_service_voucher_code')} ` +
                `ON ${Q('service_voucher')} (${Q('code')})`);
            await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${Q('idx_service_voucher_order')} ` +
                `ON ${Q('service_voucher')} (${Q('orderId')})`);
            await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${Q('idx_service_voucher_channel')} ` +
                `ON ${Q('service_voucher')} (${Q('channelId')})`);
            await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${Q('voucher_booking')} (` +
                base +
                `${Q('channelId')} integer NOT NULL, ` +
                `${Q('voucherId')} integer NOT NULL, ` +
                `${Q('customerId')} integer NOT NULL, ` +
                `${Q('shopId')} integer NOT NULL, ` +
                `${Q('slotAt')} ${ts} NOT NULL, ` +
                `${Q('customerCount')} integer NOT NULL, ` +
                `${Q('status')} varchar NOT NULL DEFAULT 'booked')`);
            await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${Q('idx_voucher_booking_voucher')} ` +
                `ON ${Q('voucher_booking')} (${Q('voucherId')})`);
            await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${Q('idx_voucher_booking_channel')} ` +
                `ON ${Q('voucher_booking')} (${Q('channelId')})`);
            // ManyToMany Channel 关联表（TypeORM 默认命名：<表>_channels_channel）
            for (const [joinTable, ownerCol] of [
                ['service_voucher_channels_channel', 'serviceVoucherId'],
                ['voucher_booking_channels_channel', 'voucherBookingId'],
            ]) {
                await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${Q(joinTable)} (` +
                    `${Q(ownerCol)} integer NOT NULL, ` +
                    `${Q('channelId')} integer NOT NULL, ` +
                    `PRIMARY KEY (${Q(ownerCol)}, ${Q('channelId')}))`);
                await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${Q(`idx_${joinTable}_${ownerCol}`)} ` +
                    `ON ${Q(joinTable)} (${Q(ownerCol)})`);
                await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${Q(`idx_${joinTable}_channelId`)} ` +
                    `ON ${Q(joinTable)} (${Q('channelId')})`);
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[VoucherTablesMigration] failed to ensure tables:', e === null || e === void 0 ? void 0 : e.message);
        }
        finally {
            await queryRunner.release();
        }
    }
};
exports.VoucherTablesMigration = VoucherTablesMigration;
exports.VoucherTablesMigration = VoucherTablesMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], VoucherTablesMigration);
//# sourceMappingURL=migrate-voucher-tables.js.map