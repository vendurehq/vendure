import { Injectable } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';
import { CUSTOMER_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { IsNull } from 'typeorm';

import { getAllPermissionsMetadata } from '../../../common/constants';
import { ConfigService } from '../../../config/config.service';
import { UserChannelPermissions } from '../../../config/session-cache/session-cache-strategy';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Customer } from '../../../entity/customer/customer.entity';
import { RoleAssignment } from '../../../entity/role-assignment/role-assignment.entity';
import { Role } from '../../../entity/role/role.entity';

/**
 * @description
 * The effective permissions of a User, as resolved by the {@link RolePermissionResolver}.
 *
 * @docsCategory auth
 * @since 4.0.0
 */
export interface ResolvedUserPermissions {
    /**
     * @description
     * The per-channel permissions derived from the User's explicit {@link RoleAssignment}s
     * and, for customer Users, from the Customer's channel memberships.
     */
    channels: UserChannelPermissions[];
    /**
     * @description
     * Permissions the User holds on _every_ Channel, including Channels created after the
     * permissions were resolved. Populated for SuperAdmin users, whose effective permissions
     * are derived at check time rather than stored per Channel.
     */
    globalPermissions: Permission[];
}

/**
 * @description
 * Resolves a User's effective per-channel permissions from {@link RoleAssignment} rows.
 * This is the single source of truth for permission resolution, used by the session cache,
 * `login`/`me`, {@link RequestContextService} and the permission guards.
 *
 * The two system roles are special-cased rather than materialized per channel:
 *
 * - **SuperAdmin**: a User holding a Role which carries the `SuperAdmin` permission (only
 *   the system SuperAdmin role can) receives all assignable permissions on every Channel,
 *   resolved at check time. Channel creation therefore needs no assignment bookkeeping —
 *   a new Channel is administrable the moment it exists — and the SuperAdmin role's own
 *   permission array does not need re-syncing when custom permissions are added.
 * - **Customer role**: a User with a Customer record receives the Customer role's
 *   permissions on the Customer's member Channels, derived from the channel membership
 *   itself. Customer-role assignments are never written — they would only duplicate the
 *   membership relation, at one row per customer per channel.
 *
 * @docsCategory auth
 * @since 4.0.0
 */
@Injectable()
export class RolePermissionResolver {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
    ) {}

    /**
     * @description
     * Resolves the effective permissions of the given User. Uses the raw connection since
     * permissions are global truth, independent of any request-scoped transaction.
     */
    async resolvePermissions(userId: ID): Promise<ResolvedUserPermissions> {
        const assignments = await this.connection.rawConnection.getRepository(RoleAssignment).find({
            where: { userId },
            relations: { role: true, channel: true },
        });
        const channelsMap = new Map<string, UserChannelPermissions>();
        const addPermissions = (channel: Channel, permissions: Permission[]) => {
            let entry = channelsMap.get(channel.code);
            if (!entry) {
                entry = {
                    id: channel.id,
                    token: channel.token,
                    code: channel.code,
                    permissions: [],
                };
                channelsMap.set(channel.code, entry);
            }
            entry.permissions = unique([...entry.permissions, ...permissions]);
        };

        let isSuperAdmin = false;
        for (const { role, channel } of assignments) {
            addPermissions(channel, role.permissions);
            if (role.permissions.includes(Permission.SuperAdmin)) {
                isSuperAdmin = true;
            }
        }
        const customer = await this.connection.rawConnection.getRepository(Customer).findOne({
            where: { user: { id: userId }, deletedAt: IsNull() },
            relations: { channels: true },
        });
        if (customer) {
            const customerRole = await this.connection.rawConnection
                .getRepository(Role)
                .findOne({ where: { code: CUSTOMER_ROLE_CODE } });
            if (customerRole) {
                for (const channel of customer.channels) {
                    addPermissions(channel, customerRole.permissions);
                }
            }
        }
        return {
            channels: [...channelsMap.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
            globalPermissions: isSuperAdmin ? this.getAllAssignablePermissions() : [],
        };
    }

    /**
     * @description
     * Expands {@link ResolvedUserPermissions} into a plain per-channel array covering every
     * Channel the User has permissions on, with `globalPermissions` applied to all Channels.
     * Used where an explicit channel list is part of the API contract (`me`/`login`'s
     * `CurrentUser.channels`); the session cache stores the compact form instead.
     */
    async expandGlobalPermissions(resolved: ResolvedUserPermissions): Promise<UserChannelPermissions[]> {
        if (resolved.globalPermissions.length === 0) {
            return resolved.channels;
        }
        const allChannels = await this.connection.rawConnection.getRepository(Channel).find();
        return allChannels
            .map(channel => {
                const entry = resolved.channels.find(c => c.id === channel.id);
                return {
                    id: channel.id,
                    token: channel.token,
                    code: channel.code,
                    permissions: unique([...(entry?.permissions ?? []), ...resolved.globalPermissions]),
                };
            })
            .sort((a, b) => (a.id < b.id ? -1 : 1));
    }

    private getAllAssignablePermissions(): Permission[] {
        return getAllPermissionsMetadata(this.configService.authOptions.customPermissions)
            .filter(p => p.assignable)
            .map(p => p.name as Permission);
    }
}
