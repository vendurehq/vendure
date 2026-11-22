import { Injectable } from '@nestjs/common';
import {
    CUSTOMER_ROLE_CODE,
    ROLE_EDITOR_ROLE_CODE,
    SUPER_ADMIN_ROLE_CODE,
} from '@vendure/common/lib/shared-constants';
import {
    EntityNotFoundError,
    Permission,
    RequestContext,
    Role,
    RoleService,
    UserInputError,
} from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

const SYSTEM_ROLE_CODES = new Set([SUPER_ADMIN_ROLE_CODE, CUSTOMER_ROLE_CODE, ROLE_EDITOR_ROLE_CODE]);

const deleteRoleInput = z.strictObject({
    id: idSchema.describe('Role ID.'),
});

type DeleteRoleToolInput = z.infer<typeof deleteRoleInput>;

@McpTool({
    name: 'delete_role',
    toolset: 'admin',
    description: 'Delete an administrator role. Administrators that hold it lose its permissions.',
    keywords: [
        'remove a staff role',
        'delete a permission group',
        'delete a role for good',
        'drop an admin role',
        'remove access level',
        'delete a role',
    ],
    permissions: [Permission.DeleteRole],
    behavior: 'destructive',
    inputSchema: deleteRoleInput,
})
@Injectable()
export class DeleteRoleTool implements McpToolHandler<DeleteRoleToolInput> {
    constructor(private readonly roleService: RoleService) {}

    async describe(ctx: RequestContext, input: DeleteRoleToolInput) {
        const role = await this.findDeletableRole(ctx, input.id);
        return (
            `Delete role "${role.code}" (id ${role.id}) with ${role.permissions.length} permission(s). ` +
            'Administrators that hold it lose them.'
        );
    }

    /** Core refuses the system roles with an internal error, so they are refused here with a clear one. */
    private async findDeletableRole(ctx: RequestContext, id: DeleteRoleToolInput['id']): Promise<Role> {
        const role = await this.roleService.findOne(ctx, id);
        if (!role) {
            throw new EntityNotFoundError('Role', id);
        }
        if (SYSTEM_ROLE_CODES.has(role.code)) {
            throw new UserInputError(`Role "${role.code}" is a system role and cannot be deleted.`);
        }
        return role;
    }

    async execute(ctx: RequestContext, input: DeleteRoleToolInput) {
        await this.findDeletableRole(ctx, input.id);
        return deletionResult(await this.roleService.delete(ctx, input.id), `Role ${input.id}`);
    }
}
