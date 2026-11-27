import { Injectable } from '@nestjs/common';
import { CountryService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { findCountriesByCode } from './country-lookup';
import { countryCodesSchema } from './setup-schemas';

const enableCountriesInput = z.strictObject({
    codes: countryCodesSchema.min(1).describe('Codes of the countries to enable.'),
});

type EnableCountriesInput = z.infer<typeof enableCountriesInput>;

@McpTool({
    name: 'enable_countries',
    toolset: 'admin',
    description:
        'Enable countries by code, so customers can choose them in addresses. It never creates a country.',
    keywords: [
        'start selling to a country',
        'allow addresses in this country',
        'turn on a country',
        'open shipping to new countries',
        'make a country available at checkout',
        'activate countries',
    ],
    permissions: [Permission.UpdateSettings, Permission.UpdateCountry],
    behavior: 'mutating',
    inputSchema: enableCountriesInput,
})
@Injectable()
export class EnableCountriesTool implements McpToolHandler<EnableCountriesInput> {
    constructor(
        private readonly countryService: CountryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: EnableCountriesInput) {
        const countries = await findCountriesByCode(ctx, this.countryService, input.codes);
        const result = [];
        for (const country of countries) {
            result.push(
                country.enabled
                    ? country
                    : await this.countryService.update(ctx, { id: country.id, enabled: true }),
            );
        }
        return { countries: result.map(country => this.serializer.country(country)) };
    }
}
