import { ConfigArg } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import {
    ConfigArgs,
    ConfigArgValues,
    ConfigurableOperationDef,
    ConfigurableOperationDefOptions,
} from '../../common/configurable-operation';
import { Order } from '../../entity/order/order.entity';
import { Promotion } from '../../entity/promotion/promotion.entity';

export type PromotionConditionState = Record<string, unknown>;

export type CheckPromotionConditionResult = boolean | PromotionConditionState;

/**
 * @description
 * A function which checks whether or not a given {@link Order} satisfies the {@link PromotionCondition}.
 *
 * The function should return either a `boolean` or and plain object type:
 *
 * * `false`: The condition is not satisfied - do not apply PromotionActions
 * * `true`: The condition is satisfied, apply PromotionActions
 * * `{ [key: string]: any; }`: The condition is satisfied, apply PromotionActions
 * _and_ pass this object into the PromotionAction's `state` argument.
 *
 * @docsCategory promotions
 * @docsPage promotion-condition
 */
export type CheckPromotionConditionFn<T extends ConfigArgs, R extends CheckPromotionConditionResult> = (
    ctx: RequestContext,
    order: Order,
    args: ConfigArgValues<T>,
    promotion: Promotion,
) => R | Promise<R>;

/**
 * @description
 * This object is used to configure a PromotionCondition.
 *
 * @docsCategory promotions
 * @docsPage promotion-condition
 * @docsWeight 1
 */
export interface PromotionConditionConfig<
    T extends ConfigArgs,
    C extends string,
    R extends CheckPromotionConditionResult,
> extends ConfigurableOperationDefOptions<T> {
    code: C;
    check: CheckPromotionConditionFn<T, R>;
    priorityValue?: number;
}

/**
 * @description
 * PromotionConditions are used to create {@link Promotion}s. The purpose of a PromotionCondition
 * is to check the order against a particular predicate function (the `check` function) and to return
 * `true` if the Order satisfies the condition, or `false` if it does not.
 *
 * @docsCategory promotions
 * @docsPage promotion-condition
 * @docsWeight 0
 */
export class PromotionCondition<
    T extends ConfigArgs = ConfigArgs,
    C extends string = string,
    R extends CheckPromotionConditionResult = any,
> extends ConfigurableOperationDef<T> {
    /**
     * @description
     * Used to determine the order of application of multiple Promotions
     * on the same Order. See the {@link Promotion} `priorityScore` field for
     * more information.
     *
     * @default 0
     */
    readonly priorityValue: number;
    private readonly checkFn: CheckPromotionConditionFn<T, R>;

    get code(): C {
        return super.code as C;
    }

    constructor(config: PromotionConditionConfig<T, C, R>) {
        super(config);
        this.checkFn = config.check;
        this.priorityValue = config.priorityValue || 0;
    }

    /**
     * @description
     * This is the function which contains the conditional logic to decide whether
     * a Promotion should apply to an Order. See {@link CheckPromotionConditionFn}.
     */
    async check(ctx: RequestContext, order: Order, args: ConfigArg[], promotion: Promotion): Promise<R> {
        return this.checkFn(ctx, order, this.argsArrayToHash(args), promotion);
    }
}
