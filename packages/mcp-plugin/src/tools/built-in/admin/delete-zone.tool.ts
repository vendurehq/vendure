import { Injectable } from '@nestjs/common';
import {
    Channel,
    EntityNotFoundError,
    Permission,
    RequestContext,
    TaxRate,
    TransactionalConnection,
    UserInputError,
    ZoneService,
} from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';
import { quotedCodes } from './preview-text';

const deleteZoneInput = z.strictObject({
    id: idSchema.describe('Zone ID.'),
});

type DeleteZoneToolInput = z.infer<typeof deleteZoneInput>;

@McpTool({
    name: 'delete_zone',
    toolset: 'admin',
    description: 'Delete a zone. A zone that a channel or a tax rate still uses is refused.',
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
    constructor(
        private readonly zoneService: ZoneService,
        private readonly connection: TransactionalConnection,
    ) {}

    async describe(ctx: RequestContext, input: DeleteZoneToolInput) {
        const zone = await this.findUnusedZone(ctx, input.id);
        return `Delete zone "${zone.name}" (id ${zone.id}), which has ${zone.members.length} member(s).`;
    }

    async execute(ctx: RequestContext, input: DeleteZoneToolInput) {
        await this.findUnusedZone(ctx, input.id);
        return deletionResult(await this.zoneService.delete(ctx, input.id), `Zone ${input.id}`);
    }

    /** Core refuses a zone that a channel or a tax rate uses, so that is refused before consent is asked. */
    private async findUnusedZone(ctx: RequestContext, id: DeleteZoneToolInput['id']) {
        const zone = await this.zoneService.findOne(ctx, id);
        if (!zone) {
            throw new EntityNotFoundError('Zone', id);
        }
        const channels = await this.connection.getRepository(ctx, Channel).find({
            where: [{ defaultTaxZone: { id: zone.id } }, { defaultShippingZone: { id: zone.id } }],
        });
        if (channels.length) {
            throw new UserInputError(
                `Zone "${zone.name}" is a default zone of channels ${quotedCodes(channels)}. ` +
                    'Change their default zones with update_channel first.',
            );
        }
        const taxRates = await this.connection
            .getRepository(ctx, TaxRate)
            .count({ where: { zone: { id: zone.id } } });
        if (taxRates) {
            throw new UserInputError(
                `Zone "${zone.name}" is used by ${taxRates} tax rate(s). Delete them or move them to another target first.`,
            );
        }
        return zone;
    }
}
