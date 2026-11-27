import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, RoleService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { roleFieldsSchema } from './role-fields-schema';

const createRoleInput = z.strictObject({ input: roleFieldsSchema });

type CreateRoleToolInput = z.infer<typeof createRoleInput>;

@McpTool({
    name: 'create_role',
    toolset: 'admin',
    description:
        'Create an administrator role in the active channel with a list of permissions. The caller can only grant permissions it holds.',
    keywords: [
        'add a staff role',
        'create a catalog editor role',
        'give support staff limited access',
        'new permission group',
        'set up an admin role',
        'make a read-only role',
    ],
    permissions: [Permission.CreateRole],
    behavior: 'mutating',
    inputSchema: createRoleInput,
})
@Injectable()
export class CreateRoleTool implements McpToolHandler<CreateRoleToolInput> {
    constructor(
        private readonly roleService: RoleService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateRoleToolInput) {
        const role = await this.roleService.create(ctx, {
            ...input.input,
            permissions: input.input.permissions as Permission[],
        });
        return { role: this.serializer.role(role) };
    }
}
