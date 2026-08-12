import { Injectable } from '@nestjs/common';
import { ChannelRoleInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ChannelRole } from '../../entity/role/channel-role.entity';
import { Role } from '../../entity/role/role.entity';
import {
    getChannelPermissions,
    UserChannelPermissions,
} from '../helpers/utils/get-user-channels-permissions';

/**
 * @description
 * Contains methods relating to {@link ChannelRole} entities, i.e. the channel-scoped assignment of
 * a {@link Role} to a {@link User}.
 *
 * All methods are no-ops unless the `authOptions.channelScopedRoles` config option is set to `true`.
 *
 * @docsCategory services
 * @since 3.8.0
 * @experimental
 */
@Injectable()
@Instrument()
export class ChannelRoleService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
    ) {}

    /**
     * @description
     * Returns `true` if channel-scoped roles are enabled in the VendureConfig.
     */
    get enabled(): boolean {
        return this.configService.authOptions.channelScopedRoles === true;
    }

    /**
     * @description
     * Returns the permissions granted to the given User by their ChannelRoles, in the same shape as
     * the permissions derived from `User.roles`. Returns an empty array (without querying) when
     * channel-scoped roles are disabled.
     */
    async getPermissionsForUser(
        ctx: RequestContext | undefined,
        userId: ID,
    ): Promise<UserChannelPermissions[]> {
        if (!this.enabled) {
            return [];
        }
        const channelRoles = await this.findByUserId(ctx, userId);
        return getChannelPermissions(
            channelRoles.map(
                channelRole =>
                    new Role({
                        permissions: channelRole.role.permissions,
                        channels: [channelRole.channel],
                    }),
            ),
        );
    }

    /**
     * @description
     * Returns all ChannelRoles for the given User, with the `role` and `channel` relations joined.
     */
    async findByUserId(ctx: RequestContext | undefined, userId: ID): Promise<ChannelRole[]> {
        if (!this.enabled) {
            return [];
        }
        return this.connection.getRepository(ctx, ChannelRole).find({
            where: { userId },
            relations: { role: true, channel: true },
        });
    }

    /**
     * @description
     * Replaces the given User's ChannelRoles with the given set, applying the difference as a single
     * bulk delete plus a single bulk insert. Returns the pairs which were added and removed.
     */
    async setChannelRoles(
        ctx: RequestContext,
        userId: ID,
        input: ChannelRoleInput[],
    ): Promise<{ added: ChannelRole[]; removed: ChannelRole[] }> {
        if (!this.enabled) {
            throw new UserInputError('error.channel-scoped-roles-not-enabled');
        }
        const repository = this.connection.getRepository(ctx, ChannelRole);
        const existing = await repository.find({ where: { userId } });
        const desired = this.flatten(userId, input);

        const removed = existing.filter(
            e => !desired.some(d => idsAreEqual(d.roleId, e.roleId) && idsAreEqual(d.channelId, e.channelId)),
        );
        const added = desired.filter(
            d =>
                !existing.some(e => idsAreEqual(d.roleId, e.roleId) && idsAreEqual(d.channelId, e.channelId)),
        );

        if (removed.length) {
            await repository.delete({ id: In(removed.map(r => r.id)) });
        }
        if (added.length) {
            await repository.save(added, { chunk: 500 });
        }
        return { added, removed };
    }

    /**
     * @description
     * Loads the Roles referenced by the given input, paired with the Channel each is being granted on.
     * Used by the privilege-escalation checks, which must be evaluated per Channel.
     */
    async getRoleChannelPairs(
        ctx: RequestContext,
        input: ChannelRoleInput[],
    ): Promise<Array<{ role: Role; channelId: ID }>> {
        const roleIds = unique(input.map(i => i.roleId));
        if (!roleIds.length) {
            return [];
        }
        const roles = await this.connection.getRepository(ctx, Role).find({ where: { id: In(roleIds) } });
        const pairs: Array<{ role: Role; channelId: ID }> = [];
        for (const { roleId, channelIds } of input) {
            const role = roles.find(r => idsAreEqual(r.id, roleId));
            if (!role) {
                throw new UserInputError('error.entity-with-id-not-found', {
                    entityName: 'Role',
                    id: roleId,
                });
            }
            for (const channelId of unique(channelIds)) {
                pairs.push({ role, channelId });
            }
        }
        return pairs;
    }

    private flatten(userId: ID, input: ChannelRoleInput[]): ChannelRole[] {
        const seen = new Set<string>();
        const result: ChannelRole[] = [];
        for (const { roleId, channelIds } of input) {
            for (const channelId of channelIds) {
                const key = `${roleId}:${channelId}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                result.push(new ChannelRole({ userId, roleId, channelId }));
            }
        }
        return result;
    }
}
