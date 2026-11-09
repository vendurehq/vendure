// 骑手群飞书抢单（2026-11-09）：Customer 飞书 open_id 绑定列。
// 与 p9-p5-rider-compliance 同模式：自定义字段是物理列（customFields + 首字母大写+其余小写），
// 生产 DB_SYNC=0 关闭同步时靠此处幂等补列；IF NOT EXISTS 重复启动安全。
// 时区（2026-11-09 热修）：boundAt 有时间语义，建列即用 timestamptz；
// 已按旧写法建出的 timestamp without time zone 列在此幂等转换（与 P5 同模式）。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p43RiderFeishuBindingSql = `
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuopenid" varchar(255);
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "customFieldsRiderfeishuboundat" timestamptz
`;

const boundAtTypeSql = `
SELECT data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customer' AND column_name = 'customFieldsRiderfeishuboundat'
`;

const alterBoundAtToTimestamptzSql = `
ALTER TABLE "customer" ALTER COLUMN "customFieldsRiderfeishuboundat" TYPE timestamptz
USING "customFieldsRiderfeishuboundat" AT TIME ZONE 'Asia/Shanghai'
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
                // 存量列不是 timestamptz 时幂等转换；列不存在则跳过
                const rows = await qr.query(boundAtTypeSql);
                const dataType: string | null = Array.isArray(rows) && rows[0] ? rows[0].data_type : null;
                const isTimestamptz = dataType === 'timestamp with time zone';
                if (dataType && !isTimestamptz) {
                    await qr.query(alterBoundAtToTimestamptzSql);
                    // eslint-disable-next-line no-console
                    console.log('[P43RiderFeishuBindingMigration] customFieldsRiderfeishuboundat → timestamptz');
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
