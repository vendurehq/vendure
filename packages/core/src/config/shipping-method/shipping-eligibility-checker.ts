import { ConfigArg } from '@vendure/common/lib/generated-types';
import { Json } from '@vendure/common/lib/shared-types';
import { createHash } from 'crypto';

import { RequestContext } from '../../api/common/request-context';
import { CacheService } from '../../cache/index';
import {
    ConfigArgs,
    ConfigArgValues,
    ConfigurableOperationDef,
    ConfigurableOperationDefOptions,
} from '../../common/configurable-operation';
import { Injector } from '../../common/index';
import { Order, ShippingMethod } from '../../entity';

/**
 * @description
 * Configuration passed into the constructor of a {@link ShippingEligibilityChecker} to
 * configure its behavior.
 *
 * @docsCategory shipping
 */
export interface ShippingEligibilityCheckerConfig<T extends ConfigArgs>
    extends ConfigurableOperationDefOptions<T> {
    check: CheckShippingEligibilityCheckerFn<T>;
    shouldRunCheck?: ShouldRunCheckFn<T>;
}
/**
 * @description
 * The ShippingEligibilityChecker class is used to check whether an order qualifies for a
 * given {@link ShippingMethod}.
 *
 * @example
 * ```ts
 * const minOrderTotalEligibilityChecker = new ShippingEligibilityChecker({
 *     code: 'min-order-total-eligibility-checker',
 *     description: [{ languageCode: LanguageCode.en, value: 'Checks that the order total is above some minimum value' }],
 *     args: {
 *         orderMinimum: { type: 'int', ui: { component: 'currency-form-input' } },
 *     },
 *     check: (ctx, order, args) => {
 *         return order.totalWithTax >= args.orderMinimum;
 *     },
 * });
 * ```
 *
 * @docsCategory shipping
 * @docsPage ShippingEligibilityChecker
 */
export class ShippingEligibilityChecker<
    T extends ConfigArgs = ConfigArgs,
> extends ConfigurableOperationDef<T> {
    private readonly checkFn: CheckShippingEligibilityCheckerFn<T>;
    private readonly shouldRunCheckFn?: ShouldRunCheckFn<T>;
    private cacheService: CacheService;

    constructor(config: ShippingEligibilityCheckerConfig<T>) {
        super(config);
        this.checkFn = config.check;
        this.shouldRunCheckFn = config.shouldRunCheck;
    }

    async init(injector: Injector) {
        await super.init(injector);
        this.cacheService = injector.get(CacheService);
    }

    /**
     * @description
     * Check the given Order to determine whether it is eligible.
     *
     * @internal
     */
    async check(
        ctx: RequestContext,
        order: Order,
        args: ConfigArg[],
        method: ShippingMethod,
    ): Promise<boolean> {
        const shouldRunCheck = await this.shouldRunCheck(ctx, order, args, method);
        return shouldRunCheck ? this.checkFn(ctx, order, this.argsArrayToHash(args), method) : true;
    }

    /**
     * Determines whether the check function needs to be run, based on the presence and
     * result of any defined `shouldRunCheckFn`.
     */
    private async shouldRunCheck(
        ctx: RequestContext,
        order: Order,
        args: ConfigArg[],
        method: ShippingMethod,
    ): Promise<boolean> {
        if (typeof this.shouldRunCheckFn === 'function') {
            const cacheKey =
                ctx.session?.id && `ShippingEligibilityChecker:shouldRunCheck:${this.code}:${ctx.session.id}`;
            if (cacheKey) {
                const checkResult = await this.shouldRunCheckFn(
                    ctx,
                    order,
                    this.argsArrayToHash(args),
                    method,
                );
                const checkResultHash = createHash('sha1')
                    .update(JSON.stringify(checkResult))
                    .digest('base64');
                const lastResultHash = await this.cacheService.get(cacheKey);
                await this.cacheService.set(cacheKey, checkResultHash, { ttl: 1000 * 60 * 60 * 5 });
                if (checkResultHash === lastResultHash) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * This is a precaution against attempting to JSON.stringify() a reference to
     * this class, which can lead to a circular reference error.
     */
    protected toJSON() {
        return {};
    }
}

/**
 * @description
 * A function which implements logic to determine whether a given {@link Order} is eligible for
 * a particular shipping method. Once a ShippingMethod has been assigned to an Order, this
 * function will be called on every change to the Order (e.g. updating quantities, adding/removing
 * items etc).
 *
 * If the code running in this function is expensive, then consider also defining
 * a {@link ShouldRunCheckFn} to avoid unnecessary calls.
 *
 * @docsCategory shipping
 */
export type CheckShippingEligibilityCheckerFn<T extends ConfigArgs> = (
    ctx: RequestContext,
    order: Order,
    args: ConfigArgValues<T>,
    method: ShippingMethod,
) => boolean | Promise<boolean>;

/**
 * @description
 * An optional method which is used to decide whether to run the `check()` function.
 * Returns a JSON-compatible object which is cached and compared between calls.
 * If the value is the same, then the `check()` function is not called.
 *
 * Use of this function is an optimization technique which can be useful when
 * the `check()` function is expensive and should be kept to an absolute minimum.
 *
 * @example
 * ```ts
 * const optimizedChecker = new ShippingEligibilityChecker({
 *   code: 'example',
 *   description: [],
 *   args: {},
 *   check: async (ctx, order) => {
 *     // some slow, expensive function here
 *   },
 *   shouldRunCheck: (ctx, order) => {
 *     // Will only run the `check()` function any time
 *     // the shippingAddress object has changed.
 *     return order.shippingAddress;
 *   },
 * });
 * ```
 *
 * @docsCategory shipping
 */
export type ShouldRunCheckFn<T extends ConfigArgs> = (
    ctx: RequestContext,
    order: Order,
    args: ConfigArgValues<T>,
    method: ShippingMethod,
) => Json | Promise<Json>;
