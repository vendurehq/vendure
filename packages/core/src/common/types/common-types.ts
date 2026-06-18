import { LogicalOperator } from '@vendure/common/lib/generated-types';
import { Type } from '@vendure/common/lib/shared-types';

import { VendureEntity } from '../../entity/base/base.entity';
import { Channel } from '../../entity/channel/channel.entity';
import { Tag } from '../../entity/tag/tag.entity';

import { LocaleString } from './locale-types';

/**
 * @description
 * Entities which can be assigned to Channels should implement this interface.
 *
 * @docsCategory entities
 * @docsPage interfaces
 */
export interface ChannelAware {
    channels: Channel[];
}

/**
 * @description
 * Entities which can be soft deleted should implement this interface.
 *
 * @docsCategory entities
 * @docsPage interfaces
 */
export interface SoftDeletable {
    deletedAt: Date | null;
}

/**
 * @description
 * Entities which can be ordered relative to their siblings in a list.
 *
 * @docsCategory entities
 * @docsPage interfaces
 */
export interface Orderable {
    position: number;
}

/**
 * @description
 * Entities which can have Tags applied to them.
 *
 * @docsCategory entities
 * @docsPage interfaces
 */
export interface Taggable {
    tags: Tag[];
}

/**
 * Creates a type based on T, but with all properties non-optional
 * and readonly.
 */
export type ReadOnlyRequired<T> = { +readonly [K in keyof T]-?: T[K] };

/**
 * Given an array type e.g. Array<string>, return the inner type e.g. string.
 */
export type UnwrappedArray<T extends any[]> = T[number];

/**
 * Parameters for list queries
 */
export interface ListQueryOptions<T extends VendureEntity> {
    take?: number | null;
    skip?: number | null;
    sort?: NullOptionals<SortParameter<T>> | null;
    filter?: NullOptionals<FilterParameter<T>> | null;
    filterOperator?: LogicalOperator;
}

/**
 * Returns a type T where any optional fields also have the "null" type added.
 * This is needed to provide interop with the Apollo-generated interfaces, where
 * nullable fields have the type `field?: <type> | null`.
 */
export type NullOptionals<T> = {
    [K in keyof T]: undefined extends T[K] ? NullOptionals<T[K]> | null : NullOptionals<T[K]>;
};

export type SortOrder = 'ASC' | 'DESC';

// prettier-ignore
export type PrimitiveFields<T extends VendureEntity> = {
    [K in keyof T]: NonNullable<T[K]> extends LocaleString | number | string | boolean | Date ? K : never
}[keyof T];

// prettier-ignore
export type SortParameter<T extends VendureEntity> = {
    [K in PrimitiveFields<T>]?: SortOrder
};

// prettier-ignore
export type CustomFieldSortParameter = {
    [customField: string]: SortOrder;
};

// prettier-ignore
export type FilterParameter<T extends VendureEntity> = {
    [K in PrimitiveFields<T>]?: T[K] extends string | LocaleString ? StringOperators
        : T[K] extends number ? NumberOperators
            : T[K] extends boolean ? BooleanOperators
                : T[K] extends Date ? DateOperators : StringOperators;
} & {
    _and?: Array<FilterParameter<T>>;
    _or?: Array<FilterParameter<T>>;
};

export interface StringOperators {
    eq?: string;
    notEq?: string;
    contains?: string;
    notContains?: string;
    in?: string[];
    notIn?: string[];
    regex?: string;
    isNull?: boolean;
}

export interface BooleanOperators {
    eq?: boolean;
    isNull?: boolean;
}

export interface NumberRange {
    start: number;
    end: number;
}

export interface NumberOperators {
    eq?: number;
    lt?: number;
    lte?: number;
    gt?: number;
    gte?: number;
    between?: NumberRange;
    isNull?: boolean;
}

export interface DateRange {
    start: Date;
    end: Date;
}

export interface DateOperators {
    eq?: Date;
    before?: Date;
    after?: Date;
    between?: DateRange;
    isNull?: boolean;
}

export interface ListOperators {
    inList?: string | number | boolean | Date;
}

export type PaymentMetadata = {
    [prop: string]: any;
} & {
    public?: any;
};

/**
 * @description
 * The result of the price calculation from the {@link ProductVariantPriceCalculationStrategy} or the
 * {@link OrderItemPriceCalculationStrategy}.
 *
 * @docsCategory Common
 */
export type PriceCalculationResult = {
    price: number;
    priceIncludesTax: boolean;
};

// eslint-disable-next-line @typescript-eslint/ban-types
export type MiddlewareHandler = Type<any> | Function;

/**
 * @description
 * Defines API middleware, set in the {@link ApiOptions}. Middleware can be either
 * [Express middleware](https://expressjs.com/en/guide/using-middleware.html) or [NestJS middleware](https://docs.nestjs.com/middleware).
 *
 * ## Increasing the maximum request body size limit
 *
 * Internally, Vendure relies on the body-parser middleware to parse incoming JSON data. By default, the maximum
 * body size is set to 100kb. Attempting to send a request with more than 100kb of JSON data will result in a
 * `PayloadTooLargeError`. To increase this limit, we can manually configure the body-parser middleware:
 *
 * @example
 * ```ts
 * import { VendureConfig } from '\@vendure/core';
 * import { json } from 'body-parser';
 *
 * export const config: VendureConfig = {
 *   // ...
 *   apiOptions: {
 *     middleware: [{
 *       handler: json({ limit: '10mb' }),
 *       route: '*splat',
 *       beforeListen: true,
 *     }],
 *   },
 * };
 * ```
 *
 * @docsCategory Common
 */
export interface Middleware {
    /**
     * @description
     * The Express middleware function or NestJS `NestMiddleware` class.
     */
    handler: MiddlewareHandler;
    /**
     * @description
     * The route to which this middleware will apply. Pattern based routes are supported as well.
     *
     * The `'ab*cd'` route path will match `abcd`, `ab_cd`, `abecd`, and so on. The characters `?`, `+`, `*`, and `()` may be used in a route path,
     * and are subsets of their regular expression counterparts. The hyphen (`-`) and the dot (`.`) are interpreted literally.
     */
    route: string;
    /**
     * @description
     * When set to `true`, this will cause the middleware to be applied before the Vendure server (and underlying Express server) starts listening
     * for connections. In practical terms this means that the middleware will be at the very start of the middleware stack, before even the
     * `body-parser` middleware which is automatically applied by NestJS. This can be useful in certain cases such as when you need to access the
     * raw unparsed request for a specific route.
     *
     * @since 1.1.0
     * @default false
     */
    beforeListen?: boolean;
}
