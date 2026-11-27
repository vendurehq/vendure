import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, Zone, ZoneService } from '@vendure/core';
import { listOptions, McpTool, McpToolHandler, page, paginationFields } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listZonesInput = z.strictObject({
    ...paginationFields('zones'),
});

type ListZonesInput = z.infer<typeof listZonesInput>;

@McpTool({
    name: 'list_zones',
    toolset: 'admin',
    description:
        'List zones, the groups of countries used for tax rates and shipping, with their member country codes.',
    keywords: [
        'which regions do we ship to',
        'show tax zones',
        'list country groups',
        'what countries are in Europe zone',
        'shipping regions',
        'see all zones',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadZone],
    behavior: 'readonly',
    inputSchema: listZonesInput,
})
@Injectable()
export class ListZonesTool implements McpToolHandler<ListZonesInput> {
    constructor(
        private readonly zoneService: ZoneService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListZonesInput) {
        const result = await this.zoneService.findAll(ctx, listOptions<Zone>(input));
        return page(
            result.items.map(zone => this.serializer.zone(zone)),
            result.totalItems,
            input,
        );
    }
}
