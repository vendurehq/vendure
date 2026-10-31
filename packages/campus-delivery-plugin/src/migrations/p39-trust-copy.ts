// §113（2026-11-01）：信任文案店铺级配置 6 列（质量/服务/时间 开关 + 自定义文案）。
// 生产 synchronize:false，新增字段必须落物理列，否则配置查询直接报 column does not exist。
// 迁移幂等（IF NOT EXISTS + 默认值），随服务启动执行。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p39TrustCopySql = `
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustQualityEnabled" boolean DEFAULT true;
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustQualityText" varchar(80);
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustServiceEnabled" boolean DEFAULT true;
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustServiceText" varchar(80);
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustTimeEnabled" boolean DEFAULT true;
ALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS "trustTimeText" varchar(80);
`;

@Injectable()
export class P39TrustCopyMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of p39TrustCopySql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P39TrustCopyMigration] failed:', e?.message);
        }
    }
}
