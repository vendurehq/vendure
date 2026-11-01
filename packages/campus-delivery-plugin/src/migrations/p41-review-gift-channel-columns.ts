// §114（2026-11-01）：好评送礼三档礼包券模板是 Channel customFields，生产 synchronize:false
// 不会自动建列，缺列会让任何 Channel 查询直接报 column does not exist（服务启动即崩）。
// 列名规则：customFields + 首字母大写其余小写（与既有 customFieldsReviewgiftcoupontemplateid 一致）。
// 幂等（IF NOT EXISTS），随服务启动执行。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p41ReviewGiftChannelColumnsSql = `
DO $$
BEGIN
  IF to_regclass('channel') IS NOT NULL THEN
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsReviewgiftqualitycoupontemplateid" varchar;
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsReviewgiftservicecoupontemplateid" varchar;
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsReviewgifttimecoupontemplateid" varchar;
  END IF;
END $$;
`;

@Injectable()
export class P41ReviewGiftChannelColumnsMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                await qr.query(p41ReviewGiftChannelColumnsSql);
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P41ReviewGiftChannelColumnsMigration] failed:', e?.message);
        }
    }
}
