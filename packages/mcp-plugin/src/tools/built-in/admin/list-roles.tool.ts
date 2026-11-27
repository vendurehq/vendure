import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, Role, RoleService } from '@vendure/core';
import { listOptions, McpTool, McpToolHandler, page, paginationFields } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listRolesInput = z.strictObject({
    ...paginationFields('roles'),
});

type ListRolesInput = z.infer<typeof listRolesInput>;

@McpTool({
    name: 'list_roles',
    toolset: 'admin',
    description: 'List the administrator roles the caller can see, with their permissions.',
    keywords: [
        'what can staff do',
        'show admin roles',
        'list permission groups',
        'who can edit the catalog',
        'see access levels',
        'role permissions',
    ],
    permissions: [Permission.ReadAdministrator, Permission.ReadRole],
    behavior: 'readonly',
    inputSchema: listRolesInput,
})
@Injectable()
export class ListRolesTool implements McpToolHandler<ListRolesInput> {
    constructor(
        private readonly roleService: RoleService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListRolesInput) {
        const result = await this.roleService.findAll(ctx, listOptions<Role>(input));
        return page(
            result.items.map(role => this.serializer.role(role)),
            result.totalItems,
            input,
        );
    }
}
