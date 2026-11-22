import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, Permission, RequestContext, ZoneService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

const deleteZoneInput = z.strictObject({
    id: idSchema.describe('Zone ID.'),
});

type DeleteZoneToolInput = z.infer<typeof deleteZoneInput>;

@McpTool({
    name: 'delete_zone',
    toolset: 'admin',
    description: 'Delete a zone. A zone that a channel or a tax rate still uses is not deleted.',
    keywords: [
        'remove a region',
        'delete a country group',
        'drop a shipping zone',
        'delete a tax zone',
        'remove a zone',
        'stop using a zone',
    ],
    permissions: [Permission.DeleteSettings, Permission.DeleteZone],
    behavior: 'destructive',
    inputSchema: deleteZoneInput,
})
@Injectable()
export class DeleteZoneTool implements McpToolHandler<DeleteZoneToolInput> {
    constructor(private readonly zoneService: ZoneService) {}

    async describe(ctx: RequestContext, input: DeleteZoneToolInput) {
        const zone = await this.zoneService.findOne(ctx, input.id);
        if (!zone) {
            throw new EntityNotFoundError('Zone', input.id);
        }
        return `Delete zone "${zone.name}" (id ${zone.id}), which has ${zone.members.length} member(s).`;
    }

    async execute(ctx: RequestContext, input: DeleteZoneToolInput) {
        return deletionResult(await this.zoneService.delete(ctx, input.id), `Zone ${input.id}`);
    }
}
