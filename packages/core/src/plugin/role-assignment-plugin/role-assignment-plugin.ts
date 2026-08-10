import { OnApplicationBootstrap } from '@nestjs/common';

import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ProcessContext } from '../../process-context/process-context';
import { PluginCommonModule } from '../plugin-common.module';
import { VendurePlugin } from '../vendure-plugin';

import { loggerCtx } from './constants';
import { RoleAssignmentMigrationService } from './role-assignment-migration.service';
import { RoleAssignmentPermissionResolverStrategy } from './role-assignment-permission-resolver-strategy';
import { RoleAssignment } from './role-assignment.entity';

/**
 * This plugin is registered internally by Vendure when the `experimental.roleAssignments.enabled`
 * config flag is set to `true` (see `VendureConfig.experimental`). It is never meant to be added
 * manually to the `plugins` array.
 *
 * It registers the `RoleAssignment` entity — a bridge between User, Role and Channel which
 * decouples Role definitions from Channel assignments. Assignments belong to Users, so they
 * cover administrator and customer users alike. On server bootstrap, if the `role_assignment`
 * table is empty, it backfills RoleAssignment rows from the legacy User -> Role -> Channel
 * relations (see {@link RoleAssignmentMigrationService}); once the table contains rows the
 * migration is not run again.
 *
 * Permission resolution is driven by RoleAssignments: the plugin's `configuration` hook installs
 * the {@link RoleAssignmentPermissionResolverStrategy}, replacing the default derivation from
 * the legacy relations. Writes to the legacy relations (e.g. `createAdministrator(roleIds: ...)`,
 * customer registration, channel creation) remain possible but are NOT yet mirrored into
 * RoleAssignments — until that sync layer lands in a subsequent stage, a manual re-run of
 * `RoleAssignmentMigrationService.migrateLegacyRoles()` picks them up.
 *
 * TODO: Administrator and Customer deletions are soft deletes which never trigger the
 * assignment table's `ON DELETE CASCADE`, so a deleted user's assignment rows linger. This
 * grants nothing (soft-deleted users cannot authenticate), but cleanup via the deletion
 * events is planned for the stage which adds the assignment admin API.
 *
 * @internal
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [RoleAssignment],
    providers: [RoleAssignmentMigrationService],
    configuration: config => {
        config.authOptions.rolePermissionResolverStrategy =
            new RoleAssignmentPermissionResolverStrategy();
        return config;
    },
    compatibility: '>0.0.0',
})
export class RoleAssignmentPlugin implements OnApplicationBootstrap {
    constructor(
        private connection: TransactionalConnection,
        private processContext: ProcessContext,
        private migrationService: RoleAssignmentMigrationService,
    ) {}

    async onApplicationBootstrap() {
        if (!this.processContext.isServer) {
            return;
        }
        const tableName = this.connection.rawConnection.getMetadata(RoleAssignment).tableName;
        const queryRunner = this.connection.rawConnection.createQueryRunner();
        let tableExists: boolean;
        try {
            tableExists = await queryRunner.hasTable(tableName);
        } finally {
            await queryRunner.release();
        }
        if (!tableExists) {
            Logger.error(
                `The experimental.roleAssignments flag is enabled but the "${tableName}" table does not exist. ` +
                    'Generate and run a database migration to create it.',
                loggerCtx,
            );
            return;
        }
        const existing = await this.connection.rawConnection
            .getRepository(RoleAssignment)
            .find({ take: 1, select: { id: true } });
        if (existing.length > 0) {
            return;
        }
        await this.migrationService.migrateLegacyRoles();
    }
}
