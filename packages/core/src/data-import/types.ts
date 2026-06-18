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
    taxRates: Array<{ name: string; percentage: number }>;
    shippingMethods: Array<{ name: string; price: number; taxRate?: number }>;
    paymentMethods: Array<{ name: string; handler: ConfigurableOperationInput }>;
    collections: CollectionDefinition[];
}
