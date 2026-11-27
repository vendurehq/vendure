import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, RoleService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { roleFieldsSchema } from './role-fields-schema';

const updateRoleInput = z.strictObject({
    id: idSchema.describe('Role ID.'),
    input: roleFieldsSchema.partial(),
});

type UpdateRoleToolInput = z.infer<typeof updateRoleInput>;

@McpTool({
    name: 'update_role',
    toolset: 'admin',
    description:
        "Change a role's code, description or permissions. " +
        'Only the fields given change. ' +
        'A permissions list replaces the old one, and the caller can only grant permissions it holds.',
    keywords: [
        'give a role more permissions',
        'remove access from a role',
        'edit staff permissions',
        'rename a role',
        'change what a role can do',
        'update role permissions',
    ],
    permissions: [Permission.UpdateRole],
    behavior: 'mutating',
    inputSchema: updateRoleInput,
})
@Injectable()
export class UpdateRoleTool implements McpToolHandler<UpdateRoleToolInput> {
    constructor(
        private readonly roleService: RoleService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateRoleToolInput) {
        const { permissions, ...fields } = input.input;
        const role = await this.roleService.update(ctx, {
            ...fields,
            id: input.id,
            ...(permissions ? { permissions: permissions as Permission[] } : {}),
        });
        return { role: this.serializer.role(role) };
    }
}
