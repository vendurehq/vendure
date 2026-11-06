// 确保 tenant_member 表存在 mustChangePassword 列（首登强改密）
// 生产（PostgreSQL）与本地开发（SQLite）都可能关闭 synchronize，故此 migration 幂等地补列。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection, TableColumn } from 'typeorm';

@Injectable()
export class TenantMemberColumnMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const metadata = this.connection.getMetadata('TenantMember');
            const tableName = metadata.tableName;
            const queryRunner = this.connection.createQueryRunner();
            try {
                const ensure = async (name: string, type: string, nullable: boolean, defaultVal?: unknown) => {
                    if (!(await queryRunner.hasColumn(tableName, name))) {
                        await queryRunner.addColumn(
                            tableName,
                            new TableColumn({
                                name,
                                type,
                                isNullable: nullable,
                                default: defaultVal,
                            }),
                        );
                    }
                };
                await ensure('must_change_password', 'boolean', false, false);
                await ensure('phone', 'varchar(32)', true, undefined);
                // 一次性重置口令有效期（A3）：随机口令 + 强制改密 + 过期失效
                // 列名与实体属性一致（TypeORM 默认命名策略按属性名落库）
                await ensure('resetPasswordExpiresAt', 'timestamp', true, undefined);
            } finally {
                await queryRunner.release();
            }
        } catch (e: any) {
            // 补列失败不阻塞启动，等待下次启动重试
            // eslint-disable-next-line no-console
            console.error('[TenantMemberColumnMigration] failed to ensure columns:', e?.message);
        }
    }
}