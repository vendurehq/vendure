import { describe, expectTypeOf, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { AvailableStock, StockLocationStrategy } from '../catalog/stock-location-strategy';

import { composeStrategy, removeLayer, setLayerPriority } from './compose-strategy';
import { StrategyLayer } from './strategy-layer';

declare const stockLocationStrategy: StockLocationStrategy;

type GetAvailableStockArgs = Parameters<StockLocationStrategy['getAvailableStock']>;

class FullLayer extends StrategyLayer<StockLocationStrategy> implements StockLocationStrategy {
    static priority = 100;
    getAvailableStock(...args: GetAvailableStockArgs) {
        return this.inner.getAvailableStock(...args);
    }
    forAllocation(...args: Parameters<StockLocationStrategy['forAllocation']>) {
        return this.inner.forAllocation(...args);
    }
    forRelease(...args: Parameters<StockLocationStrategy['forRelease']>) {
        return this.inner.forRelease(...args);
    }
    forSale(...args: Parameters<StockLocationStrategy['forSale']>) {
        return this.inner.forSale(...args);
    }
    forCancellation(...args: Parameters<StockLocationStrategy['forCancellation']>) {
        return this.inner.forCancellation(...args);
    }
}

class ReserveLayer extends StrategyLayer.passThrough<StockLocationStrategy, { reserve: number }>() {
    static priority = 200;
    async getAvailableStock(...args: GetAvailableStockArgs): Promise<AvailableStock> {
        const stock = await this.inner.getAvailableStock(...args);
        return { ...stock, stockOnHand: stock.stockOnHand - this.options.reserve };
    }
}

class NoOptionsLayer extends StrategyLayer.passThrough<StockLocationStrategy>() {
    static priority = 300;
}

describe('composeStrategy() types', () => {
    it('returns the strategy type', () => {
        const composed = composeStrategy(FullLayer, ReserveLayer.with({ reserve: 1 }), stockLocationStrategy);
        expectTypeOf(composed).toEqualTypeOf<StockLocationStrategy>();
    });

    it('accepts a layer without options as the bare class', () => {
        composeStrategy(NoOptionsLayer, stockLocationStrategy);
    });

    it('rejects a layer with options as the bare class', () => {
        // @ts-expect-error ReserveLayer needs options
        composeStrategy(ReserveLayer, stockLocationStrategy);
    });

    it('rejects a layer of a different strategy', () => {
        interface OtherStrategy extends InjectableStrategy {
            other(): string;
        }
        class OtherLayer extends StrategyLayer<OtherStrategy> implements OtherStrategy {
            static priority = 1;
            other() {
                return this.inner.other();
            }
        }
        // @ts-expect-error OtherLayer is not a layer of StockLocationStrategy
        composeStrategy(OtherLayer, stockLocationStrategy);
        // @ts-expect-error OtherLayer is not a layer of StockLocationStrategy
        removeLayer(stockLocationStrategy, OtherLayer);
    });

    it('rejects a layer that neither implements the strategy nor uses passThrough()', () => {
        class PartialLayer extends StrategyLayer<StockLocationStrategy> {
            static priority = 1;
            getAvailableStock(...args: GetAvailableStockArgs) {
                return this.inner.getAvailableStock(...args);
            }
        }
        // @ts-expect-error PartialLayer is not a StockLocationStrategy
        composeStrategy(PartialLayer, stockLocationStrategy);
    });

    it('accepts a layer class with options in removeLayer() and setLayerPriority()', () => {
        removeLayer(stockLocationStrategy, ReserveLayer);
        setLayerPriority(stockLocationStrategy, ReserveLayer, 10);
    });
});

describe('with() types', () => {
    it('accepts the options of the layer', () => {
        ReserveLayer.with({ reserve: 1 });
        ReserveLayer.with({ reserve: 1 }, { priority: 5 });
        NoOptionsLayer.with(undefined, { priority: 5 });
    });

    it('rejects wrong options', () => {
        // @ts-expect-error reserve must be a number
        ReserveLayer.with({ reserve: '1' });
        // @ts-expect-error unknown option
        ReserveLayer.with({ reserve: 1, other: true });
        // @ts-expect-error the options are required
        ReserveLayer.with();
        // @ts-expect-error the layer has no options
        NoOptionsLayer.with({ reserve: 1 });
    });
});

describe('layer method types', () => {
    it('rejects a wrong method signature in a passThrough() layer', () => {
        class WrongReturnType extends StrategyLayer.passThrough<StockLocationStrategy>() {
            static priority = 1;
            // @ts-expect-error the return type is not Promise<AvailableStock>
            getAvailableStock(...args: GetAvailableStockArgs) {
                return Promise.resolve('wrong');
            }
        }
        class WrongParameter extends StrategyLayer.passThrough<StockLocationStrategy>() {
            static priority = 1;
            // @ts-expect-error the first parameter is a RequestContext
            getAvailableStock(ctx: string): Promise<AvailableStock> {
                return Promise.resolve({ stockOnHand: 0, stockAllocated: 0 });
            }
        }
    });

    it('requires each method in a layer that implements the strategy', () => {
        // @ts-expect-error forAllocation() and the other methods are missing
        class MissingMethods extends StrategyLayer<StockLocationStrategy> implements StockLocationStrategy {
            static priority = 1;
            getAvailableStock(...args: GetAvailableStockArgs) {
                return this.inner.getAvailableStock(...args);
            }
        }
    });

    it('types inner and options', () => {
        class Inspect extends StrategyLayer.passThrough<StockLocationStrategy, { reserve: number }>() {
            static priority = 1;
            check(ctx: RequestContext) {
                expectTypeOf(this.inner).toEqualTypeOf<StockLocationStrategy>();
                expectTypeOf(this.options).toEqualTypeOf<{ reserve: number }>();
            }
        }
    });
});
