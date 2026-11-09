// 骑手群飞书抢单（2026-11-09）：Customer 飞书 open_id 绑定列。
// 与 p9-p5-rider-compliance 同模式：自定义字段是物理列（customFields + 首字母大写+其余小写），
// 生产 DB_SYNC=0 关闭同步时靠此处幂等补列；IF NOT EXISTS 重复启动安全。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p43RiderFeishuBindingSql = `
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuopenid" varchar(255);
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuboundat" timestamp
`;

@Injectable()
export class P43RiderFeishuBindingMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of p43RiderFeishuBindingSql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P43RiderFeishuBindingMigration] failed:', e?.message);
        }
    }
}
