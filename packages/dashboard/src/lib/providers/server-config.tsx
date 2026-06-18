import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { useQuery } from '@tanstack/react-query';
import { ResultOf } from 'gql.tada';
import React from 'react';

export const customFieldConfigFragment = graphql(`
    fragment CustomFieldConfig on CustomField {
        name
        type
        list
        description {
            languageCode
            value
        }
        label {
            languageCode
            value
        }
        readonly
        nullable
        requiresPermission
        ui
    }
`);

export const stringCustomFieldFragment = graphql(
    `
        fragment StringCustomField on StringCustomFieldConfig {
            ...CustomFieldConfig
            pattern
            options {
                label {
                    languageCode
                    value
                }
                value
            }
        }
    `,
    [customFieldConfigFragment],
);
export const localeStringCustomFieldFragment = graphql(
    `
        fragment LocaleStringCustomField on LocaleStringCustomFieldConfig {
            ...CustomFieldConfig
            pattern
        }
    `,
    [customFieldConfigFragment],
);
export const textCustomFieldFragment = graphql(
    `
        fragment TextCustomField on TextCustomFieldConfig {
            ...CustomFieldConfig
        }
    `,
    [customFieldConfigFragment],
);
export const localeTextCustomFieldFragment = graphql(
    `
        fragment LocaleTextCustomField on LocaleTextCustomFieldConfig {
            ...CustomFieldConfig
        }
    `,
    [customFieldConfigFragment],
);
export const booleanCustomFieldFragment = graphql(
    `
        fragment BooleanCustomField on BooleanCustomFieldConfig {
            ...CustomFieldConfig
        }
    `,
    [customFieldConfigFragment],
);
export const intCustomFieldFragment = graphql(
    `
        fragment IntCustomField on IntCustomFieldConfig {
            ...CustomFieldConfig
            intMin: min
            intMax: max
            intStep: step
        }
    `,
    [customFieldConfigFragment],
);
export const floatCustomFieldFragment = graphql(
    `
        fragment FloatCustomField on FloatCustomFieldConfig {
            ...CustomFieldConfig
            floatMin: min
            floatMax: max
            floatStep: step
        }
    `,
    [customFieldConfigFragment],
);
export const dateTimeCustomFieldFragment = graphql(
    `
        fragment DateTimeCustomField on DateTimeCustomFieldConfig {
            ...CustomFieldConfig
            datetimeMin: min
            datetimeMax: max
            datetimeStep: step
        }
    `,
    [customFieldConfigFragment],
);
export const relationCustomFieldFragment = graphql(
    `
        fragment RelationCustomField on RelationCustomFieldConfig {
            ...CustomFieldConfig
            entity
            scalarFields
        }
    `,
    [customFieldConfigFragment],
);

export const structCustomFieldFragment = graphql(
    `
        fragment StructCustomField on StructCustomFieldConfig {
            ...CustomFieldConfig
            fields {
                ... on StructField {
                    __typename
                    name
                    type
                    list
                    description {
                        languageCode
                        value
                    }
                    label {
                        languageCode
                        value
                    }
                    ui
                }
                ... on StringStructFieldConfig {
                    pattern
                    options {
                        label {
                            languageCode
                            value
                        }
                        value
                    }
                }
                ... on IntStructFieldConfig {
                    intMin: min
                    intMax: max
                    intStep: step
                }
                ... on FloatStructFieldConfig {
                    floatMin: min
                    floatMax: max
                    floatStep: step
                }
                ... on DateTimeStructFieldConfig {
                    datetimeMin: min
                    datetimeMax: max
                    datetimeStep: step
                }
            }
        }
    `,
    [customFieldConfigFragment],
);

export const allCustomFieldsFragment = graphql(
    `
        fragment CustomFields on CustomField {
            ... on StringCustomFieldConfig {
                ...StringCustomField
            }
            ... on LocaleStringCustomFieldConfig {
                ...LocaleStringCustomField
            }
            ... on TextCustomFieldConfig {
                ...TextCustomField
            }
            ... on LocaleTextCustomFieldConfig {
                ...LocaleTextCustomField
            }
            ... on BooleanCustomFieldConfig {
                ...BooleanCustomField
            }
            ... on IntCustomFieldConfig {
                ...IntCustomField
            }
            ... on FloatCustomFieldConfig {
                ...FloatCustomField
            }
            ... on DateTimeCustomFieldConfig {
                ...DateTimeCustomField
            }
            ... on RelationCustomFieldConfig {
                ...RelationCustomField
            }
            ... on StructCustomFieldConfig {
                ...StructCustomField
            }
        }
    `,
    [
        stringCustomFieldFragment,
        localeStringCustomFieldFragment,
        textCustomFieldFragment,
        localeTextCustomFieldFragment,
        booleanCustomFieldFragment,
        intCustomFieldFragment,
        floatCustomFieldFragment,
        dateTimeCustomFieldFragment,
        relationCustomFieldFragment,
        structCustomFieldFragment,
    ],
);

export const getServerConfigDocument = graphql(
    `
        query GetServerConfig {
            globalSettings {
                id
                availableLanguages
                serverConfig {
                    moneyStrategyPrecision
                    orderProcess {
                        name
                        to
                    }
                    permittedAssetTypes
                    permissions {
                        name
                        description
                        assignable
                    }
                    entityCustomFields {
                        entityName
                        customFields {
                            ...CustomFields
                        }
                    }
                }
            }
        }
    `,
    [allCustomFieldsFragment],
);

type QueryResult = ResultOf<typeof getServerConfigDocument>['globalSettings']['serverConfig'];
export type CustomFieldConfig = QueryResult['entityCustomFields'][number]['customFields'][number];

export interface ServerConfig {
    availableLanguages: string[];
    moneyStrategyPrecision: QueryResult['moneyStrategyPrecision'];
    orderProcess: QueryResult['orderProcess'];
    permittedAssetTypes: QueryResult['permittedAssetTypes'];
    permissions: QueryResult['permissions'];
    entityCustomFields: QueryResult['entityCustomFields'];
}

// create a provider for the global settings
export const ServerConfigProvider = ({ children }: { children: React.ReactNode }) => {
    const { user } = useAuth();
    const queryKey = ['getServerConfig', user?.id];
    const { data } = useQuery({
        queryKey,
        queryFn: () => api.query(getServerConfigDocument),
        retry: false,
        enabled: !!user?.id,
        // The server config rarely changes during a session (it's driven by
        // VendureConfig at boot time). Treat it as session-stable so we don't
        // re-fetch on every reconnect, which would cause flashes of empty
        // custom-field configuration as queries are re-derived.
        staleTime: Infinity,
        refetchOnReconnect: false,
    });
    // Memoise the context value on the underlying query data so that
    // consumers (and the memoised hooks downstream) see a stable reference
    // for the array fields when the data hasn't changed.
    const value = React.useMemo<ServerConfig | null>(
        () =>
            data?.globalSettings
                ? {
                      availableLanguages: data.globalSettings.availableLanguages ?? [],
                      moneyStrategyPrecision: data.globalSettings.serverConfig.moneyStrategyPrecision ?? 2,
                      orderProcess: data.globalSettings.serverConfig.orderProcess ?? [],
                      permittedAssetTypes: data.globalSettings.serverConfig.permittedAssetTypes ?? [],
                      permissions: data.globalSettings.serverConfig.permissions ?? [],
                      entityCustomFields: data.globalSettings.serverConfig.entityCustomFields ?? [],
                  }
                : null,
        [data],
    );

    return <ServerConfigContext.Provider value={value}>{children}</ServerConfigContext.Provider>;
};

export const ServerConfigContext = React.createContext<ServerConfig | null>(null);
