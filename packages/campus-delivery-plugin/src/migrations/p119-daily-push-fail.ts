// §119 日报推送失败原因可见（2026-11-01）。
// 生产 synchronize: false，启动幂等补列（IF NOT EXISTS，重复启动安全）。
// 只加两列，不动既有列；列名遵循 Vendure 自定义字段规则（全小写）。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p119DailyPushFailSql = `
ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "customFieldsWaimaidailypushlastfailat" varchar(16);
ALTER TABLE "channel" ADD COLUMN IF NOT EXISTS "customFieldsWaimaidailypushlastfailreason" varchar(200);
`;

@Injectable()
export class P119DailyPushFailMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of p119DailyPushFailSql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            console.error('[P119DailyPushFailMigration] failed:', e?.message);
        }
    }
}
