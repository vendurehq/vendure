// 骑手飞书抢单 B 方案（2026-11-09）：open_id 是应用维度标识，必须与骑手独立应用 appId 一起匹配。
// 自定义字段是物理列（customFields + 首字母大写+其余小写），生产 DB_SYNC=0 时靠此处幂等补列。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p46RiderFeishuAppSql = `
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuappid" varchar(255)
`;

@Injectable()
export class P46RiderFeishuAppMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of p46RiderFeishuAppSql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P46RiderFeishuAppMigration] failed:', e?.message);
        }
    }
}
