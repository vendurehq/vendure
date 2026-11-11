import { Injector } from '../../common/injector';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * A class that extends {@link StrategyLayer} for the strategy type `S`, with the options type `O`.
 * An instance of the class must be assignable to `S`. Thus the class either uses `implements S`,
 * or extends `StrategyLayer.passThrough<S>()`.
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage StrategyLayer
 */
export type StrategyLayerClass<S extends InjectableStrategy, O = any> = (abstract new () => StrategyLayer<
    S,
    O
> &
    S) & { priority: number };

/**
 * @description
 * The return value of {@link StrategyLayer}`.with()`. It holds the layer class, the options, and an
 * optional priority that replaces the static `priority` of the class.
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage StrategyLayer
 */
export interface ConfiguredStrategyLayer<S extends InjectableStrategy> {
    readonly layer: StrategyLayerClass<S>;
    readonly options: unknown;
    readonly priority?: number;
}

/**
 * @description
 * A value that {@link composeStrategy} accepts as a layer: a layer class without options, or the
 * return value of `with()`. A layer class with options must be given with `with()`.
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage StrategyLayer
 */
export type StrategyLayerType<S extends InjectableStrategy> =
    | StrategyLayerClass<S, void>
    | StrategyLayerClass<S, undefined>
    | ConfiguredStrategyLayer<S>;

/**
 * @description
 * The base class of a strategy layer. A layer holds the next strategy in the chain (`inner`) and has
 * the same interface as that strategy. A layer changes the result of a configured strategy, and the
 * plugin that supplies the layer does not replace the strategy. Use {@link composeStrategy} to add a
 * layer to a strategy option.
 *
 * Rules:
 *
 * * The class of a layer is its identity. A strategy chain contains each layer class one time.
 *   The class name is the name of the layer in the logs.
 * * The static `priority` sets the position in the chain. A layer with a lower number gets the call first.
 *   The order of the `plugins` array has no effect.
 * * Vendure creates the layer instance. A layer class has no constructor arguments. Vendure sets
 *   `inner` and `options` before it calls `init()`.
 * * Vendure calls `init()` on the base strategy and then on each layer from the inside out. It calls
 *   `destroy()` in the opposite order. A layer does not call `init()` or `destroy()` on `inner`.
 * * Vendure sends each method that the layer class does not define to `inner`. If `inner` does not
 *   have an optional method, the layer does not have it either. Vendure finds the members of `inner`
 *   when it builds the chain, before `init()`. A member that a strategy adds to itself in `init()`
 *   is not forwarded.
 *
 * A layer that uses `implements` must define each method of the strategy interface. A layer that
 * defines only some methods extends `StrategyLayer.passThrough<S>()`.
 *
 * @example
 * ```ts
 * import {
 *     Injector,
 *     OrderItemPriceCalculationStrategy,
 *     PriceCalculationResult,
 *     RequestContext,
 *     StrategyLayer,
 * } from '\@vendure/core';
 *
 * export class MinimumPriceLayer
 *     extends StrategyLayer<OrderItemPriceCalculationStrategy, { minimum: number }>
 *     implements OrderItemPriceCalculationStrategy
 * {
 *     static priority = 300;
 *
 *     async calculateUnitPrice(
 *         ...args: Parameters<OrderItemPriceCalculationStrategy['calculateUnitPrice']>
 *     ): Promise<PriceCalculationResult> {
 *         const result = await this.inner.calculateUnitPrice(...args);
 *         return { ...result, price: Math.max(result.price, this.options.minimum) };
 *     }
 * }
 * ```
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage StrategyLayer
 * @docsWeight 0
 */
export abstract class StrategyLayer<S extends InjectableStrategy, O = void> implements InjectableStrategy {
    /**
     * @description
     * The position of the layer in the chain. A layer with a lower number gets the call first.
     * Each layer class must set it.
     */
    static priority: number;

    /**
     * @description
     * The next strategy in the chain. Vendure sets it before `init()`.
     */
    protected readonly inner: S;

    /**
     * @description
     * The options from `with()`. `undefined` if the layer was added as the bare class.
     */
    protected readonly options: O;

    /**
     * @description
     * Returns this layer class with options. The optional `priority` replaces the static
     * `priority` of the class. The identity of the layer stays the class.
     *
     * @example
     * ```ts
     * composeStrategy(MinimumPriceLayer.with({ minimum: 100 }, { priority: 250 }), strategy);
     * ```
     */
    static with<T extends StrategyLayerClass<any>>(
        this: T & StrategyLayerClass<T extends abstract new () => StrategyLayer<infer TS, any> ? TS : never>,
        options: T extends abstract new () => StrategyLayer<any, infer TO> ? TO : never,
        override?: { priority?: number },
    ): ConfiguredStrategyLayer<T extends abstract new () => StrategyLayer<infer TS, any> ? TS : never> {
        return { layer: this, options, priority: override?.priority };
    }

    /**
     * @description
     * Returns `StrategyLayer` with a type that has each member of the strategy interface `S`. Extend it
     * when a layer defines only some methods of `S`. Vendure sends the other methods to `inner`.
     * TypeScript checks the signature of each method that the layer defines against `S`.
     *
     * @example
     * ```ts
     * export class AvailableStockLayer extends StrategyLayer.passThrough<StockLocationStrategy>() {
     *     static priority = 200;
     *
     *     async getAvailableStock(...args: Parameters<StockLocationStrategy['getAvailableStock']>) {
     *         const stock = await this.inner.getAvailableStock(...args);
     *         return { ...stock, stockOnHand: Math.max(stock.stockOnHand - 5, 0) };
     *     }
     * }
     * ```
     */
    static passThrough<S extends InjectableStrategy, O = void>(): (abstract new () => StrategyLayer<S, O> &
        S) &
        Omit<typeof StrategyLayer, 'prototype'> {
        return StrategyLayer as any;
    }

    init?(injector: Injector): void | Promise<void>;

    destroy?(): void | Promise<void>;
}
