import { Injectable } from '@nestjs/common';
import { SortOrder } from '@vendure/common/lib/generated-types';
import { Country, CountryService, Permission, RequestContext } from '@vendure/core';
import {
    booleanFilter,
    listOptions,
    McpTool,
    McpToolHandler,
    page,
    paginationFields,
    stringFilter,
} from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listCountriesInput = z.strictObject({
    ...paginationFields('countries'),
    filter: z
        .strictObject({
            code: stringFilter.describe('Filter by country code.').optional(),
            name: stringFilter.describe('Filter by country name.').optional(),
            enabled: booleanFilter.describe('Filter by whether the country is enabled.').optional(),
        })
        .optional(),
});

type ListCountriesInput = z.infer<typeof listCountriesInput>;

@McpTool({
    name: 'list_countries',
    toolset: 'admin',
    description:
        'List the countries the store knows, with their codes and whether each is enabled, sorted by code.',
    keywords: [
        'which countries can customers pick',
        'show enabled countries',
        'find the code for a country',
        'list all nations',
        'is this country available',
        'country codes',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadCountry],
    behavior: 'readonly',
    inputSchema: listCountriesInput,
})
@Injectable()
export class ListCountriesTool implements McpToolHandler<ListCountriesInput> {
    constructor(
        private readonly countryService: CountryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListCountriesInput) {
        const result = await this.countryService.findAll(ctx, {
            ...listOptions<Country>(input),
            sort: { code: SortOrder.ASC },
        });
        return page(
            result.items.map(country => this.serializer.country(country)),
            result.totalItems,
            input,
        );
    }
}
