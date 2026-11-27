import { Injectable } from '@nestjs/common';
import { CountryService, Permission, RequestContext, ZoneService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { findCountriesByCode } from './country-lookup';
import { zoneFieldsSchema } from './zone-fields-schema';

const createZoneInput = z.strictObject({ input: zoneFieldsSchema });

type CreateZoneToolInput = z.infer<typeof createZoneInput>;

@McpTool({
    name: 'create_zone',
    toolset: 'admin',
    description: 'Create a zone, a named group of countries used for tax rates and shipping.',
    keywords: [
        'group countries into a region',
        'add a shipping region',
        'make a tax zone',
        'create a zone for the EU',
        'define where we sell',
        'new country group',
    ],
    permissions: [Permission.CreateSettings, Permission.CreateZone],
    behavior: 'mutating',
    inputSchema: createZoneInput,
})
@Injectable()
export class CreateZoneTool implements McpToolHandler<CreateZoneToolInput> {
    constructor(
        private readonly zoneService: ZoneService,
        private readonly countryService: CountryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateZoneToolInput) {
        const members = await findCountriesByCode(
            ctx,
            this.countryService,
            input.input.memberCountryCodes ?? [],
        );
        const zone = await this.zoneService.create(ctx, {
            name: input.input.name,
            memberIds: members.map(country => country.id),
        });
        return { zone: this.serializer.zone(zone) };
    }
}
