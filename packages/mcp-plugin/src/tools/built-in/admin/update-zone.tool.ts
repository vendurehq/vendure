import { Injectable } from '@nestjs/common';
import {
    CountryService,
    EntityNotFoundError,
    idsAreEqual,
    Permission,
    RequestContext,
    ZoneService,
} from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { findCountriesByCode } from './country-lookup';
import { zoneFieldsSchema } from './zone-fields-schema';

const updateZoneInput = z.strictObject({
    id: idSchema.describe('Zone ID.'),
    input: zoneFieldsSchema.partial(),
});

type UpdateZoneToolInput = z.infer<typeof updateZoneInput>;

@McpTool({
    name: 'update_zone',
    toolset: 'admin',
    description:
        "Rename a zone or replace its member countries. A memberCountryCodes list replaces the zone's members exactly.",
    keywords: [
        'add a country to a zone',
        'remove a country from a region',
        'rename a zone',
        'change which countries we ship to',
        'edit a tax zone',
        'update zone members',
    ],
    permissions: [Permission.UpdateSettings, Permission.UpdateZone],
    behavior: 'mutating',
    inputSchema: updateZoneInput,
})
@Injectable()
export class UpdateZoneTool implements McpToolHandler<UpdateZoneToolInput> {
    constructor(
        private readonly zoneService: ZoneService,
        private readonly countryService: CountryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateZoneToolInput) {
        const current = await this.zoneService.findOne(ctx, input.id);
        if (!current) {
            throw new EntityNotFoundError('Zone', input.id);
        }
        if (input.input.name !== undefined) {
            await this.zoneService.update(ctx, { id: input.id, name: input.input.name });
        }
        if (input.input.memberCountryCodes) {
            const wanted = await findCountriesByCode(
                ctx,
                this.countryService,
                input.input.memberCountryCodes,
            );
            const toAdd = wanted.filter(
                country => !current.members.some(member => idsAreEqual(member.id, country.id)),
            );
            const toRemove = current.members.filter(
                member => !wanted.some(country => idsAreEqual(country.id, member.id)),
            );
            if (toAdd.length) {
                await this.zoneService.addMembersToZone(ctx, {
                    zoneId: input.id,
                    memberIds: toAdd.map(country => country.id),
                });
            }
            if (toRemove.length) {
                await this.zoneService.removeMembersFromZone(ctx, {
                    zoneId: input.id,
                    memberIds: toRemove.map(member => member.id),
                });
            }
        }
        const zone = await this.zoneService.findOne(ctx, input.id);
        return { zone: zone ? this.serializer.zone(zone) : null };
    }
}
