// §126（2026-11-01）：售后规则三项阈值是 Channel customFields，生产 synchronize:false 不会自动建列，
// 缺列会让任何 Channel 查询报 column does not exist（服务启动即崩），故必须先补物理列。
// 列名规则：customFields + 首字母大写其余小写（与既有 customFieldsAftersalestimeouthours 一致）。
// 幂等（IF NOT EXISTS），随服务启动执行；生产上线前另已手工执行同一 DDL。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p42ChannelAfterSalesRuleColumnsSql = `
DO $$
BEGIN
  IF to_regclass('channel') IS NOT NULL THEN
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsAftersalesduesoonhours" int;
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsAftersalesfirstresponsetargethours" int;
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsAftersalesresolvetargethours" int;
  END IF;
END $$;
`;

@Injectable()
export class P42ChannelAfterSalesRuleColumnsMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                await qr.query(p42ChannelAfterSalesRuleColumnsSql);
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P42ChannelAfterSalesRuleColumnsMigration] failed:', e?.message);
        }
    }
}
