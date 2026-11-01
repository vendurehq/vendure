// §114（2026-11-01）：好评送礼闭环 Review.giftChoice（quality/service/time）。
// 生产 synchronize:false，review-plugin 新增字段必须落物理列，否则 createReview 直接报 column does not exist。
// 幂等（IF NOT EXISTS + to_regclass 判表存在），随服务启动执行。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p40ReviewGiftChoiceSql = `
DO $$
BEGIN
  IF to_regclass('review') IS NOT NULL THEN
    ALTER TABLE review ADD COLUMN IF NOT EXISTS "giftChoice" varchar(16);
  END IF;
END $$;
`;

@Injectable()
export class P40ReviewGiftChoiceMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                await qr.query(p40ReviewGiftChoiceSql);
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P40ReviewGiftChoiceMigration] failed:', e?.message);
        }
    }
}
