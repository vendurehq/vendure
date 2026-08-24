import { Injectable } from '@nestjs/common';
import { CUSTOMER_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Customer } from '../../entity/customer/customer.entity';
import { RoleAssignment } from '../../entity/role-assignment/role-assignment.entity';
import { Role } from '../../entity/role/role.entity';
import { User } from '../../entity/user/user.entity';
import {
    ResolvedUserPermissions,
    RolePermissionResolver,
} from '../helpers/role-permission-resolver/role-permission-resolver';

/**
 * @description
 * Contains methods relating to {@link RoleAssignment} entities — the `(user, role, channel)`
 * triples which grant a User a Role's permissions on a specific Channel.
 *
 * Write methods do not perform authorization themselves: callers are responsible for
 * asserting that the active user may grant the Roles involved (see
 * {@link RoleService.assertActiveUserCanGrantRoles}). All writes go through entity-based
 * repository operations so that {@link SessionService}'s entity subscriber observes them
 * and evicts the affected User's cached sessions — permission changes therefore take
 * effect on the User's next request.
 *
 * @docsCategory services
 * @since 4.0.0
 */
@Injectable()
@Instrument()
export class RoleAssignmentService {
    constructor(
        private connection: TransactionalConnection,
        private rolePermissionResolver: RolePermissionResolver,
    ) {}

    /**
     * @description
     * Resolves the effective permissions of the given User. See {@link RolePermissionResolver}.
     */
    resolvePermissions(userId: ID): Promise<ResolvedUserPermissions> {
        return this.rolePermissionResolver.resolvePermissions(userId);
    }

    /**
     * @description
     * Returns the distinct Roles assigned to the given User across all Channels.
     */
    async resolveUserRoles(ctx: RequestContext, userId: ID): Promise<Role[]> {
        const assignments = await this.connection.getRepository(ctx, RoleAssignment).find({
            where: { userId },
            relations: { role: true },
        });
        const roles = assignments.map(({ role }) => role);
        // The Customer role is derived from channel membership rather than stored as
        // assignment rows (see RolePermissionResolver), so it is added back here.
        const customer = await this.connection.getRepository(ctx, Customer).findOne({
            where: { user: { id: userId }, deletedAt: IsNull() },
        });
        if (customer) {
            const customerRole = await this.connection
                .getRepository(ctx, Role)
                .findOne({ where: { code: CUSTOMER_ROLE_CODE } });
            if (customerRole) {
                roles.push(customerRole);
            }
        }
        // The same Role assigned on several Channels yields one row per Channel.
        return unique(roles, 'id');
    }

    /**
     * @description
     * Returns the ids of all non-deleted Users holding the given Role on any Channel.
     */
    async resolveUserIdsWithRole(ctx: RequestContext, roleId: ID): Promise<ID[]> {
        const assignmentRows = await this.connection
            .getRepository(ctx, RoleAssignment)
            .createQueryBuilder('assignment')
            .select('user.id', 'userId')
            .innerJoin(User, 'user', 'user.id = assignment.userId AND user.deletedAt IS NULL')
            .where('assignment.roleId = :roleId', { roleId })
            .getRawMany<{ userId: ID }>();
        const userIds = assignmentRows.map(row => row.userId);

        // Mirror resolveUserRoles: the membership-derived Customer role has no assignment
        // rows, so asking who holds it must return the customer Users.
        const role = await this.connection.getRepository(ctx, Role).findOne({ where: { id: roleId } });
        if (role?.code === CUSTOMER_ROLE_CODE) {
            const customerRows = await this.connection
                .getRepository(ctx, Customer)
                .createQueryBuilder('customer')
                .select('user.id', 'userId')
                .innerJoin('customer.user', 'user', 'user.deletedAt IS NULL')
                .where('customer.deletedAt IS NULL')
                .getRawMany<{ userId: ID }>();
            userIds.push(...customerRows.map(row => row.userId));
        }
        return unique(userIds);
    }

    /**
     * @description
     * Returns the ids of the Roles assigned to the given User on the given Channel.
     */
    async getAssignedRoleIdsOnChannel(ctx: RequestContext, userId: ID, channelId: ID): Promise<ID[]> {
        const assignments = await this.connection.getRepository(ctx, RoleAssignment).find({
            where: { userId, channelId },
        });
        return unique(assignments.map(a => a.roleId));
    }

    /**
     * @description
     * Replaces the User's Role assignments on the given Channel with the given Roles,
     * leaving assignments on other Channels untouched.
     *
     * This implements the `roleIds` inputs of the administrator and API-key mutations, which
     * are read as "replace this User's Roles on the active Channel" — a `roleIds` grant
     * always carried a channel in the request (the `vendure-token` header), it was just
     * never part of the write.
     */
    // TODO(OSS-300): whether the `roleIds` inputs survive at all (vs. an explicit
    // `roleAssignments` vocabulary only) is an open decision — see the implementation plan.
    async replaceUserAssignmentsOnChannel(
        ctx: RequestContext,
        userId: ID,
        roleIds: ID[],
        channelId: ID = ctx.channelId,
    ): Promise<void> {
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.find({ where: { userId, channelId } });
        const targetRoleIds = unique(roleIds);
        const toRemove = existing.filter(a => !targetRoleIds.some(id => idsAreEqual(id, a.roleId)));
        const toAdd = targetRoleIds.filter(id => !existing.some(a => idsAreEqual(a.roleId, id)));
        if (toRemove.length) {
            await repository.remove(toRemove);
        }
        if (toAdd.length) {
            await repository.save(toAdd.map(roleId => new RoleAssignment({ userId, roleId, channelId })));
        }
    }

    /**
     * @description
     * Assigns the Role to the User on the given Channel. Idempotent: an existing identical
     * assignment is left as-is.
     */
    async assignRoleOnChannel(
        ctx: RequestContext,
        userId: ID,
        roleId: ID,
        channelId: ID = ctx.channelId,
    ): Promise<void> {
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.findOne({ where: { userId, roleId, channelId } });
        if (!existing) {
            await repository.save(new RoleAssignment({ userId, roleId, channelId }));
        }
    }
}
