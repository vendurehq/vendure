import { Country, CountryService, RequestContext, Translated, UserInputError } from '@vendure/core';

/**
 * Finds the countries with the given codes, in the order given. Throws when a code matches no
 * country, naming every unknown code at once, so an agent can fix its input in one step.
 */
export async function findCountriesByCode(
    ctx: RequestContext,
    countryService: CountryService,
    codes: string[],
): Promise<Array<Translated<Country>>> {
    const wanted = [...new Set(codes.map(code => code.toUpperCase()))];
    if (wanted.length === 0) {
        return [];
    }
    const { items } = await countryService.findAll(ctx, {
        filter: { code: { in: wanted } },
        take: wanted.length,
    });
    const byCode = new Map(items.map(country => [country.code.toUpperCase(), country]));
    const unknown = wanted.filter(code => !byCode.has(code));
    if (unknown.length > 0) {
        throw new UserInputError(
            `No country has the code ${unknown.map(code => `"${code}"`).join(', ')}. ` +
                'Use list_countries to see the available codes.',
        );
    }
    return wanted.map(code => byCode.get(code) as Translated<Country>);
}
