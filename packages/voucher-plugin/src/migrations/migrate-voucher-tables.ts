// 幂等补建券包两张表及其渠道关联表（VoucherPlugin 首次上线）。
// 生产（PostgreSQL）与本地开发（SQLite）都可能关闭 synchronize，故用 IF NOT EXISTS 兜底；
// 列名/类型与 service-voucher.entity.ts、voucher-booking.entity.ts 及 TypeORM 默认命名对齐。
// 建表失败不阻塞启动，等待下次启动重试。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

function isPostgres(driver: string): boolean {
    return driver === 'postgres' || driver === 'postgresql';
}

@Injectable()
export class VoucherTablesMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        const queryRunner = this.connection.createQueryRunner();
        try {
            const pg = isPostgres((this.connection.options as any).type as string);
            const pk = pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
            const ts = pg ? 'timestamp' : 'datetime';
            const now = pg ? 'now()' : 'CURRENT_TIMESTAMP';
            const Q = (s: string) => `"${s}"`;
            const base =
                `${Q('id')} ${pk}, ` +
                `${Q('createdAt')} ${ts} NOT NULL DEFAULT ${now}, ` +
                `${Q('updatedAt')} ${ts} NOT NULL DEFAULT ${now}, ` +
                `${Q('deletedAt')} ${ts} NULL, `;

            await queryRunner.query(
                `CREATE TABLE IF NOT EXISTS ${Q('service_voucher')} (` +
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
                    `${Q('refundedAt')} ${ts} NULL)`,
            );
            await queryRunner.query(
                `CREATE UNIQUE INDEX IF NOT EXISTS ${Q('idx_service_voucher_code')} ` +
                    `ON ${Q('service_voucher')} (${Q('code')})`,
            );
            await queryRunner.query(
                `CREATE INDEX IF NOT EXISTS ${Q('idx_service_voucher_order')} ` +
                    `ON ${Q('service_voucher')} (${Q('orderId')})`,
            );
            await queryRunner.query(
                `CREATE INDEX IF NOT EXISTS ${Q('idx_service_voucher_channel')} ` +
                    `ON ${Q('service_voucher')} (${Q('channelId')})`,
            );

            await queryRunner.query(
                `CREATE TABLE IF NOT EXISTS ${Q('voucher_booking')} (` +
                    base +
                    `${Q('channelId')} integer NOT NULL, ` +
                    `${Q('voucherId')} integer NOT NULL, ` +
                    `${Q('customerId')} integer NOT NULL, ` +
                    `${Q('shopId')} integer NOT NULL, ` +
                    `${Q('slotAt')} ${ts} NOT NULL, ` +
                    `${Q('customerCount')} integer NOT NULL, ` +
                    `${Q('status')} varchar NOT NULL DEFAULT 'booked')`,
            );
            await queryRunner.query(
                `CREATE UNIQUE INDEX IF NOT EXISTS ${Q('idx_voucher_booking_voucher')} ` +
                    `ON ${Q('voucher_booking')} (${Q('voucherId')})`,
            );
            await queryRunner.query(
                `CREATE INDEX IF NOT EXISTS ${Q('idx_voucher_booking_channel')} ` +
                    `ON ${Q('voucher_booking')} (${Q('channelId')})`,
            );

            // ManyToMany Channel 关联表（TypeORM 默认命名：<表>_channels_channel）
            for (const [joinTable, ownerCol] of [
                ['service_voucher_channels_channel', 'serviceVoucherId'],
                ['voucher_booking_channels_channel', 'voucherBookingId'],
            ] as const) {
                await queryRunner.query(
                    `CREATE TABLE IF NOT EXISTS ${Q(joinTable)} (` +
                        `${Q(ownerCol)} integer NOT NULL, ` +
                        `${Q('channelId')} integer NOT NULL, ` +
                        `PRIMARY KEY (${Q(ownerCol)}, ${Q('channelId')}))`,
                );
                await queryRunner.query(
                    `CREATE INDEX IF NOT EXISTS ${Q(`idx_${joinTable}_${ownerCol}`)} ` +
                        `ON ${Q(joinTable)} (${Q(ownerCol)})`,
                );
                await queryRunner.query(
                    `CREATE INDEX IF NOT EXISTS ${Q(`idx_${joinTable}_channelId`)} ` +
                        `ON ${Q(joinTable)} (${Q('channelId')})`,
                );
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[VoucherTablesMigration] failed to ensure tables:', e?.message);
        } finally {
            await queryRunner.release();
        }
    }
}
