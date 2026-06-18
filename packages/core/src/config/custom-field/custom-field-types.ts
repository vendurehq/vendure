import {
    CustomField,
    BooleanCustomFieldConfig as GraphQLBooleanCustomFieldConfig,
    BooleanStructFieldConfig as GraphQLBooleanStructFieldConfig,
    DateTimeCustomFieldConfig as GraphQLDateTimeCustomFieldConfig,
    DateTimeStructFieldConfig as GraphQLDateTimeStructFieldConfig,
    FloatCustomFieldConfig as GraphQLFloatCustomFieldConfig,
    FloatStructFieldConfig as GraphQLFloatStructFieldConfig,
    IntCustomFieldConfig as GraphQLIntCustomFieldConfig,
    IntStructFieldConfig as GraphQLIntStructFieldConfig,
    LocaleStringCustomFieldConfig as GraphQLLocaleStringCustomFieldConfig,
    LocaleTextCustomFieldConfig as GraphQLLocaleTextCustomFieldConfig,
    RelationCustomFieldConfig as GraphQLRelationCustomFieldConfig,
    StringCustomFieldConfig as GraphQLStringCustomFieldConfig,
    StringStructFieldConfig as GraphQLStringStructFieldConfig,
    StructCustomFieldConfig as GraphQLStructCustomFieldConfig,
    StructField as GraphQLStructField,
    TextCustomFieldConfig as GraphQLTextCustomFieldConfig,
    TextStructFieldConfig as GraphQLTextStructFieldConfig,
    LocalizedString,
    Permission,
} from '@vendure/common/lib/generated-types';
import {
    CustomFieldsObject,
    CustomFieldType,
    DefaultFormComponentId,
    StructFieldType,
    Type,
    UiComponentConfig,
} from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { VendureEntity } from '../../entity/base/base.entity';

// prettier-ignore
export type DefaultValueType<T extends CustomFieldType | StructFieldType> =
    T extends 'string' | 'localeString' | 'text' | 'localeText' ? string :
    T extends 'int' | 'float' ? number :
    T extends 'boolean' ? boolean :
    T extends 'datetime' ? Date :
    T extends 'relation' ? any : never;

export type BaseTypedCustomFieldConfig<T extends CustomFieldType, C extends CustomField> = Omit<
    C,
    '__typename' | 'list' | 'requiresPermission'
> & {
    type: T;
    /**
     * @description
     * Whether the custom field is available via the Shop API.
     * @default true
     */
    public?: boolean;
    nullable?: boolean;
    unique?: boolean;
    /**
     * @description
     * The permission(s) required to read or write to this field.
     * If the user has at least one of these permissions, they will be
     * able to access the field.
     *
     * @since 2.2.0
     */
    requiresPermission?: Array<Permission | string> | Permission | string;
    /**
     * @description
     * Marks the custom field as deprecated. When set to `true` or a string,
     * the field will be marked as deprecated in the GraphQL schema.
     * If a string is provided, it will be used as the deprecation reason.
     *
     * @since 3.4.0
     */
    deprecated?: boolean | string;
    /**
     * @description
     * Configuration for the UI component used to render this custom field.
     *
     * The `dashboard` property can be set to `false` to hide this custom field
     * from the Dashboard (React admin UI). The field will be excluded from the
     * Dashboard's auto-generated queries, mutations, and form controls, but will
     * remain available in the Admin and Shop GraphQL APIs.
     *
     * This is useful for fields that are set programmatically by plugins and should
     * not be displayed to admin users.
     *
     * @example
     * ```ts
     * ui: { dashboard: false }
     * ```
     */
    ui?: UiComponentConfig<DefaultFormComponentId | string> | { dashboard?: boolean };
};

/**
 * @description
 * Configures a custom field on an entity in the {@link CustomFields} config object.
 *
 * @docsCategory custom-fields
 */
export type TypedCustomSingleFieldConfig<
    T extends CustomFieldType,
    C extends CustomField,
> = BaseTypedCustomFieldConfig<T, C> & {
    list?: false;
    defaultValue?: DefaultValueType<T>;
    validate?: (
        value: DefaultValueType<T>,
        injector: Injector,
        ctx: RequestContext,
    ) => string | LocalizedString[] | void | Promise<string | LocalizedString[] | void>;
};

export type TypedCustomListFieldConfig<
    T extends CustomFieldType,
    C extends CustomField,
> = BaseTypedCustomFieldConfig<T, C> & {
    list?: true;
    defaultValue?: Array<DefaultValueType<T>>;
    validate?: (
        value: Array<DefaultValueType<T>>,
    ) => string | LocalizedString[] | void | Promise<string | LocalizedString[] | void>;
};

export type TypedCustomFieldConfig<
    T extends CustomFieldType,
    C extends CustomField,
> = BaseTypedCustomFieldConfig<T, C> &
    (TypedCustomSingleFieldConfig<T, C> | TypedCustomListFieldConfig<T, C>);

// Type-safe custom field type definitions
export type StringCustomFieldConfig = TypedCustomFieldConfig<'string', GraphQLStringCustomFieldConfig>;
export type LocaleStringCustomFieldConfig = TypedCustomFieldConfig<
    'localeString',
    GraphQLLocaleStringCustomFieldConfig
>;
export type TextCustomFieldConfig = TypedCustomFieldConfig<'text', GraphQLTextCustomFieldConfig>;
export type LocaleTextCustomFieldConfig = TypedCustomFieldConfig<
    'localeText',
    GraphQLLocaleTextCustomFieldConfig
>;
export type IntCustomFieldConfig = TypedCustomFieldConfig<'int', GraphQLIntCustomFieldConfig>;
export type FloatCustomFieldConfig = TypedCustomFieldConfig<'float', GraphQLFloatCustomFieldConfig>;
export type BooleanCustomFieldConfig = TypedCustomFieldConfig<'boolean', GraphQLBooleanCustomFieldConfig>;
export type DateTimeCustomFieldConfig = TypedCustomFieldConfig<'datetime', GraphQLDateTimeCustomFieldConfig>;
export type RelationCustomFieldConfig = TypedCustomFieldConfig<
    'relation',
    Omit<GraphQLRelationCustomFieldConfig, 'entity' | 'scalarFields'>
> & {
    entity: Type<VendureEntity>;
    graphQLType?: string;
    eager?: boolean;
    inverseSide?: string | ((object: any) => any);
};

// Struct field definitions
export type BaseTypedStructFieldConfig<T extends StructFieldType, C extends GraphQLStructField> = Omit<
    C,
    '__typename' | 'list'
> & {
    type: T;
    ui?: UiComponentConfig<DefaultFormComponentId | string>;
};
export type TypedStructSingleFieldConfig<
    T extends StructFieldType,
    C extends GraphQLStructField,
> = BaseTypedStructFieldConfig<T, C> & {
    list?: false;
    validate?: (
        value: DefaultValueType<T>,
        injector: Injector,
        ctx: RequestContext,
    ) => string | LocalizedString[] | void | Promise<string | LocalizedString[] | void>;
};

export type TypedStructListFieldConfig<
    T extends StructFieldType,
    C extends GraphQLStructField,
> = BaseTypedStructFieldConfig<T, C> & {
    list?: true;
    validate?: (
        value: Array<DefaultValueType<T>>,
    ) => string | LocalizedString[] | void | Promise<string | LocalizedString[] | void>;
};

export type TypedStructFieldConfig<
    T extends StructFieldType,
    C extends GraphQLStructField,
> = BaseTypedStructFieldConfig<T, C> &
    (TypedStructSingleFieldConfig<T, C> | TypedStructListFieldConfig<T, C>);

export type StringStructFieldConfig = TypedStructFieldConfig<'string', GraphQLStringStructFieldConfig>;
export type TextStructFieldConfig = TypedStructFieldConfig<'text', GraphQLTextStructFieldConfig>;
export type IntStructFieldConfig = TypedStructFieldConfig<'int', GraphQLIntStructFieldConfig>;
export type FloatStructFieldConfig = TypedStructFieldConfig<'float', GraphQLFloatStructFieldConfig>;
export type BooleanStructFieldConfig = TypedStructFieldConfig<'boolean', GraphQLBooleanStructFieldConfig>;
export type DateTimeStructFieldConfig = TypedStructFieldConfig<'datetime', GraphQLDateTimeStructFieldConfig>;

/**
 * @description
 * Configures an individual field of a "struct" custom field. The individual fields share
 * the same API as the top-level custom fields, with the exception that they do not support the
 * `readonly`, `internal`, `nullable`, `unique` and `requiresPermission` options.
 *
 * @example
 * ```ts
 * const customFields: CustomFields = {
 *   Product: [
 *     {
 *       name: 'specifications',
 *       type: 'struct',
 *       fields: [
 *         { name: 'processor', type: 'string' },
 *         { name: 'ram', type: 'string' },
 *         { name: 'screenSize', type: 'float' },
 *       ],
 *     },
 *   ],
 * };
 * ```
 *
 *
 * @docsCategory custom-fields
 * @since 3.1.0
 */
export type StructFieldConfig =
    | StringStructFieldConfig
    | TextStructFieldConfig
    | IntStructFieldConfig
    | FloatStructFieldConfig
    | BooleanStructFieldConfig
    | DateTimeStructFieldConfig;

/**
 * @description
 * Configures a "struct" custom field.
 *
 * @docsCategory custom-fields
 * @since 3.1.0
 */
export type StructCustomFieldConfig = TypedCustomFieldConfig<
    'struct',
    Omit<GraphQLStructCustomFieldConfig, 'fields'>
> & {
    fields: StructFieldConfig[];
};

/**
 * @description
 * An object used to configure a custom field.
 *
 * @docsCategory custom-fields
 */
export type CustomFieldConfig =
    | StringCustomFieldConfig
    | LocaleStringCustomFieldConfig
    | TextCustomFieldConfig
    | LocaleTextCustomFieldConfig
    | IntCustomFieldConfig
    | FloatCustomFieldConfig
    | BooleanCustomFieldConfig
    | DateTimeCustomFieldConfig
    | RelationCustomFieldConfig
    | StructCustomFieldConfig;

/**
 * @description
 * Most entities can have additional fields added to them by defining an array of {@link CustomFieldConfig}
 * objects on against the corresponding key.
 *
 * @example
 * ```ts
 * bootstrap({
 *     // ...
 *     customFields: {
 *         Product: [
 *             { name: 'infoUrl', type: 'string' },
 *             { name: 'downloadable', type: 'boolean', defaultValue: false },
 *             { name: 'shortName', type: 'localeString' },
 *         ],
 *         User: [
 *             { name: 'socialLoginToken', type: 'string', public: false },
 *         ],
 *     },
 * })
 * ```
 *
 * @docsCategory custom-fields
 */
export type CustomFields = {
    Address?: CustomFieldConfig[];
    Administrator?: CustomFieldConfig[];
    ApiKey?: CustomFieldConfig[];
    Asset?: CustomFieldConfig[];
    Channel?: CustomFieldConfig[];
    Collection?: CustomFieldConfig[];
    Customer?: CustomFieldConfig[];
    CustomerGroup?: CustomFieldConfig[];
    Facet?: CustomFieldConfig[];
    FacetValue?: CustomFieldConfig[];
    Fulfillment?: CustomFieldConfig[];
    GlobalSettings?: CustomFieldConfig[];
    HistoryEntry?: CustomFieldConfig[];
    Order?: CustomFieldConfig[];
    OrderLine?: CustomFieldConfig[];
    Payment?: CustomFieldConfig[];
    PaymentMethod?: CustomFieldConfig[];
    Product?: CustomFieldConfig[];
    ProductOption?: CustomFieldConfig[];
    ProductOptionGroup?: CustomFieldConfig[];
    ProductVariant?: CustomFieldConfig[];
    ProductVariantPrice?: CustomFieldConfig[];
    Promotion?: CustomFieldConfig[];
    Refund?: CustomFieldConfig[];
    Region?: CustomFieldConfig[];
    Seller?: CustomFieldConfig[];
    Session?: CustomFieldConfig[];
    ShippingLine?: CustomFieldConfig[];
    ShippingMethod?: CustomFieldConfig[];
    StockLevel?: CustomFieldConfig[];
    StockLocation?: CustomFieldConfig[];
    StockMovement?: CustomFieldConfig[];
    TaxCategory?: CustomFieldConfig[];
    TaxRate?: CustomFieldConfig[];
    User?: CustomFieldConfig[];
    Zone?: CustomFieldConfig[];
} & { [entity: string]: CustomFieldConfig[] };

/**
 * This interface should be implemented by any entity which can be extended
 * with custom fields.
 */
export interface HasCustomFields {
    customFields: CustomFieldsObject;
}
