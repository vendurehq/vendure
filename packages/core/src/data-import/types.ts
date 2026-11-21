import { ConfigurableOperationInput, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { Zone } from '../entity/zone/zone.entity';

export type ZoneMap = Map<string, { entity: Zone; members: ID[] }>;

export interface CountryDefinition {
    code: string;
    name: string;
    zone: string;
}

export interface FacetValueCollectionFilterDefinition {
    code: 'facet-value-filter';
    args: {
        facetValueNames: string[];
        containsAny: boolean;
    };
}

export type CollectionFilterDefinition = FacetValueCollectionFilterDefinition;

export interface CollectionDefinition {
    name: string;
    description?: string;
    slug?: string;
    private?: boolean;
    filters?: CollectionFilterDefinition[];
    inheritFilters?: boolean;
    parentName?: string;
    assetPaths?: string[];
}

export interface RoleDefinition {
    code: string;
    description: string;
    permissions: Permission[];
}

/**
 * @description
 * An object defining initial settings for a new Vendure installation.
 *
 * @docsCategory import-export
 */
export interface InitialData {
    defaultLanguage: LanguageCode;
    defaultZone: string;
    roles?: RoleDefinition[];
    countries: CountryDefinition[];
    /**
     * @description
     * For each item, a {@link TaxCategory} named `name` is created, and then a {@link TaxRate}
     * for that category is created in every zone: the zones defined in `countries`, plus any
     * zones that already exist.
     *
     * Each TaxRate gets `percentage`, unless `zones` sets a different value for its zone.
     * The keys of `zones` are zone names, as used in `countries[].zone`. Populating fails
     * if a key does not match a zone.
     *
     * @example
     * ```ts
     * taxRates: [
     *     { name: 'Standard Tax', percentage: 19, zones: { France: 20, Hungary: 27 } },
     * ],
     * ```
     */
    taxRates: Array<{ name: string; percentage: number; zones?: Record<string, number> }>;
    shippingMethods: Array<{ name: string; price: number; taxRate?: number }>;
    paymentMethods: Array<{ name: string; handler: ConfigurableOperationInput }>;
    collections: CollectionDefinition[];
}
