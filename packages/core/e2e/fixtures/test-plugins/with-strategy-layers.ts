import {
    composeStrategy,
    Injector,
    OrderItemPriceCalculationStrategy,
    PriceCalculationResult,
    ProductService,
    StrategyLayer,
    StrategyLayerClass,
    VendurePlugin,
} from '@vendure/core';

type PriceArgs = Parameters<OrderItemPriceCalculationStrategy['calculateUnitPrice']>;

/**
 * The names of the layers and of the base strategy, in the order of their lifecycle calls and
 * of their price calls.
 */
export const strategyLayerEvents = {
    init: [] as string[],
    destroy: [] as string[],
    calls: [] as string[],
};

/**
 * The base waits longest and the outer layers wait less. If core did not wait for each `init()`,
 * the events would have a different order.
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A base strategy that returns a price of 0.
 */
export class ZeroPriceStrategy implements OrderItemPriceCalculationStrategy {
    async init(injector: Injector) {
        await delay(60);
        injector.get(ProductService);
        strategyLayerEvents.init.push('ZeroPriceStrategy');
    }

    async destroy() {
        await delay(10);
        strategyLayerEvents.destroy.push('ZeroPriceStrategy');
    }

    calculateUnitPrice(): PriceCalculationResult {
        strategyLayerEvents.calls.push('ZeroPriceStrategy');
        return { price: 0, priceIncludesTax: false };
    }
}

/**
 * Each layer multiplies the inner price by 10 and adds its digit. Thus the price shows the
 * order of the layers: the digit of the outermost layer is the last digit.
 */
function digitLayer(digit: number): StrategyLayerClass<OrderItemPriceCalculationStrategy> {
    return class extends StrategyLayer.passThrough<OrderItemPriceCalculationStrategy>() {
        static priority = digit * 100;

        async init() {
            await delay(digit * 10);
            strategyLayerEvents.init.push(this.constructor.name);
        }

        async destroy() {
            await delay(60 - digit * 10);
            strategyLayerEvents.destroy.push(this.constructor.name);
        }

        async calculateUnitPrice(...args: PriceArgs): Promise<PriceCalculationResult> {
            strategyLayerEvents.calls.push(this.constructor.name);
            const result = await this.inner.calculateUnitPrice(...args);
            return { ...result, price: result.price * 10 + digit };
        }
    };
}

export class DigitOneLayer extends digitLayer(1) {}
export class DigitTwoLayer extends digitLayer(2) {}
export class DigitThreeLayer extends digitLayer(3) {}
export class DigitFourLayer extends digitLayer(4) {}

function layerPlugin(layer: typeof DigitOneLayer) {
    @VendurePlugin({
        configuration: config => {
            config.orderOptions.orderItemPriceCalculationStrategy = composeStrategy(
                layer,
                config.orderOptions.orderItemPriceCalculationStrategy,
            );
            return config;
        },
    })
    class LayerPlugin {}
    return LayerPlugin;
}

export const DigitOnePlugin = layerPlugin(DigitOneLayer);
export const DigitTwoPlugin = layerPlugin(DigitTwoLayer);
export const DigitThreePlugin = layerPlugin(DigitThreeLayer);
export const DigitFourPlugin = layerPlugin(DigitFourLayer);
