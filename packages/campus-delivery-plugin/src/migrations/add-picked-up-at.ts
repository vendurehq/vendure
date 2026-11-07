// 已取餐时间锚点（2026-11-07）：自营快递/骑手确认取餐写 pickedUpAt，在途时钟只认它。
// 生产 PostgreSQL 可能关闭 synchronize，故启动时补列；IF NOT EXISTS 幂等，重复启动无副作用。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const addPickedUpAtSql = `
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "customFieldsPickedupat" timestamp with time zone;
`;

@Injectable()
export class AddPickedUpAtMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const queryRunner = this.connection.createQueryRunner();
            try {
                await queryRunner.query(addPickedUpAtSql);
            } finally {
                await queryRunner.release();
            }
        } catch (e: any) {
            // 表尚未建立（首次安装先跑建表）等情况只打日志，等待下次启动重试
            // eslint-disable-next-line no-console
            console.error('[AddPickedUpAtMigration] failed:', e?.message);
        }
    }
}
