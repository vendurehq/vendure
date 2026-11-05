/* eslint-disable no-shadow,@typescript-eslint/no-shadow */
// prettier-ignore
import { LocalizedString } from './generated-types';

/**
 * A recursive implementation of the Partial<T> type.
 * Source: https://stackoverflow.com/a/49936686/772859
 */
export type DeepPartial<T> = {
    [P in keyof T]?:
        | null
        | (T[P] extends Array<infer U>
              ? Array<DeepPartial<U>>
              : T[P] extends ReadonlyArray<infer U>
                ? ReadonlyArray<DeepPartial<U>>
                : DeepPartial<T[P]>);
};
/* eslint-enable no-shadow, @typescript-eslint/no-shadow */

/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/**
 * A recursive implementation of Required<T>.
 * Source: https://github.com/microsoft/TypeScript/issues/15012#issuecomment-365453623
 */
export type DeepRequired<T, U extends object | undefined = undefined> = T extends object
    ? {
          [P in keyof T]-?: NonNullable<T[P]> extends NonNullable<U | Function | Type<any>>
              ? NonNullable<T[P]>
              : DeepRequired<NonNullable<T[P]>, U>;
      }
    : T;
/* eslint-enable @typescript-eslint/no-unsafe-function-type */

/**
 * A type representing the type rather than instance of a class.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export interface Type<T> extends Function {
    // eslint-disable-next-line @typescript-eslint/prefer-function-type
    new (...args: any[]): T;
}

export type Json = null | boolean | number | string | Json[] | { [prop: string]: Json };

/**
 * @description
 * A type representing JSON-compatible values.
 * From https://github.com/microsoft/TypeScript/issues/1897#issuecomment-580962081
 *
 * @docsCategory common
 */
export type JsonCompatible<T> = {
    [P in keyof T]: T[P] extends Json
        ? T[P]
        : Pick<T, P> extends Required<Pick<T, P>>
          ? never
          : JsonCompatible<T[P]>;
};

/**
 * @description
 * A type describing the shape of a paginated list response. In Vendure, almost all list queries
 * (`products`, `collections`, `orders`, `customers` etc) return an object of this type.
 *
 * @docsCategory common
 */
export type PaginatedList<T> = {
    items: T[];
    totalItems: number;
};

/**
 * @description
 * An entity ID. Depending on the configured {@link EntityIdStrategy}, it will be either
 * a `string` or a `number`;
 *
 * @docsCategory common
 */
export type ID = string | number;

/**
 * @description
 * A data type for a custom field. The CustomFieldType determines the data types used in the generated
 * database columns and GraphQL fields as follows (key: m = MySQL, p = Postgres, s = SQLite):
 *
 * Type         | DB type                               | GraphQL type
 * -----        |---------                              |---------------
 * string       | varchar                               | String
 * localeString | varchar                               | String
 * text         | longtext(m), text(p,s)                | String
 * localeText   | longtext(m), text(p,s)                | String
 * int          | int                                   | Int
 * float        | double precision                      | Float
 * boolean      | tinyint (m), bool (p), boolean (s)    | Boolean
 * datetime     | datetime (m,s), timestamp (p)         | DateTime
 * struct       | json (m), jsonb (p), text (s)         | JSON
 * relation     | many-to-one / many-to-many relation   | As specified in config
 *
 * Additionally, the CustomFieldType also dictates which [configuration options](/developer-guide/custom-fields/#custom-field-config-properties)
 * are available for that custom field.
 *
 * @docsCategory custom-fields
 */
export type CustomFieldType =
    | 'string'
    | 'localeString'
    | 'int'
    | 'float'
    | 'boolean'
    | 'datetime'
    | 'relation'
    | 'text'
    | 'localeText'
    | 'struct';

export type StructFieldType = 'string' | 'int' | 'float' | 'boolean' | 'datetime' | 'text';

/**
 * @description
 * Certain entities (those which implement {@link ConfigurableOperationDef}) allow arbitrary
 * configuration arguments to be specified which can then be set in the Dashboard and used in
 * the business logic of the app. These are the valid data types of such arguments.
 * The data type influences:
 *
 * 1. How the argument form field is rendered in the Dashboard
 * 2. The JavaScript type into which the value is coerced before being passed to the business logic.
 *
 * @docsCategory ConfigurableOperationDef
 */
export type ConfigArgType = 'string' | 'int' | 'float' | 'boolean' | 'datetime' | 'ID';

/**
 * @description
 * The ids of the default form input components that ship with the
 * Admin UI.
 *
 * @docsCategory ConfigurableOperationDef
 */
export type DefaultFormComponentId =
    | 'boolean-form-input'
    | 'currency-form-input'
    | 'customer-group-form-input'
    | 'date-form-input'
    | 'facet-value-form-input'
    | 'json-editor-form-input'
    | 'html-editor-form-input'
    | 'number-form-input'
    | 'password-form-input'
    | 'product-selector-form-input'
    | 'relation-form-input'
    | 'rich-text-form-input'
    | 'select-form-input'
    | 'text-form-input'
    | 'textarea-form-input'
    | 'product-multi-form-input'
    | 'combination-mode-form-input'
    | 'struct-form-input';

/**
 * @description
 * Used to define the expected arguments for a given default form input component.
 *
 * @docsCategory ConfigurableOperationDef
 */
type DefaultFormConfigHash = {
    'boolean-form-input': Record<string, never>;
    'currency-form-input': Record<string, never>;
    'customer-group-form-input': Record<string, never>;
    'date-form-input': { min?: string; max?: string; yearRange?: number };
    'facet-value-form-input': Record<string, never>;
    'json-editor-form-input': { height?: string };
    'html-editor-form-input': { height?: string };
    'number-form-input': { min?: number; max?: number; step?: number; prefix?: string; suffix?: string };
    'password-form-input': Record<string, never>;
    'product-selector-form-input': Record<string, never>;
    'relation-form-input': Record<string, never>;
    'rich-text-form-input': Record<string, never>;
    'select-form-input': {
        options?: Array<{ value: string; label?: Array<Omit<LocalizedString, '__typename'>> }>;
    };
    'text-form-input': { prefix?: string; suffix?: string };
    'textarea-form-input': {
        spellcheck?: boolean;
    };
    'product-multi-form-input': {
        selectionMode?: 'product' | 'variant';
    };
    'combination-mode-form-input': Record<string, never>;
    'struct-form-input': Record<string, never>;
};

export type DefaultFormComponentUiConfig<T extends DefaultFormComponentId | string> =
    T extends DefaultFormComponentId ? DefaultFormConfigHash[T] : any;

export type DefaultFormComponentConfig<T extends DefaultFormComponentId | string> =
    DefaultFormComponentUiConfig<T> & {
        ui?: DefaultFormComponentUiConfig<T>;
    };

export type UiComponentConfig<T extends DefaultFormComponentId | string> = T extends DefaultFormComponentId
    ? {
          component: T;
          tab?: string;
      } & DefaultFormConfigHash[T]
    : {
          component: string;
          tab?: string;
          [prop: string]: any;
      };

export type CustomFieldsObject = { [key: string]: any };
