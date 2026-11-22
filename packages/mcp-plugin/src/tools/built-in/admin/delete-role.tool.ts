import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, Permission, RequestContext, RoleService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

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
        'revoke a role',
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
        const role = await this.roleService.findOne(ctx, input.id);
        if (!role) {
            throw new EntityNotFoundError('Role', input.id);
        }
        return `Delete role "${role.code}" (id ${role.id}) with ${role.permissions.length} permission(s). Administrators that hold it lose them.`;
    }

    async execute(ctx: RequestContext, input: DeleteRoleToolInput) {
        return deletionResult(await this.roleService.delete(ctx, input.id), `Role ${input.id}`);
    }
}
