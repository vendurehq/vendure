// 骑手飞书抢单 B 方案（2026-11-09）：
// 1) open_id 是应用维度标识，必须与骑手独立应用 appId 一起匹配 → 新增 riderFeishuAppId 物理列。
// 2) p43 曾用裸 timestamp 建 boundAt；若目标库已按旧迁移落成 timestamp without time zone，
//    这里幂等转成 timestamptz（TypeORM 写入的是 UTC 瞬时值，故按 UTC 解释）。
// 迁移必须幂等：建列 IF NOT EXISTS，类型转换先查 information_schema。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p46RiderFeishuAppSql = `
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

@Injectable()
export class P46RiderFeishuAppMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                // 含 DO $$ 块，不能按分号拆分，整段交给 pg 执行
                await qr.query(p46RiderFeishuAppSql);
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P46RiderFeishuAppMigration] failed:', e?.message);
        }
    }
}
