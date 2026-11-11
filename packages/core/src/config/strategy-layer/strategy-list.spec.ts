import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { ActiveOrderStrategy } from '../order/active-order-strategy';

import { addStrategyToList, removeStrategyFromList } from './strategy-list';
import { RemovedStrategyListEntry, sortStrategyList } from './strategy-list-entries';

class FirstStrategy implements ActiveOrderStrategy {
    readonly name = 'first';
    determineActiveOrder() {
        return Promise.resolve(undefined);
    }
}
class SecondStrategy extends FirstStrategy {
    readonly name = 'second';
}
class ThirdStrategy extends FirstStrategy {
    readonly name = 'third';
}

const names = (list: ActiveOrderStrategy[]) =>
    list.filter(e => !(e instanceof RemovedStrategyListEntry)).map(e => e.name);

describe('addStrategyToList()', () => {
    it('accepts one strategy or a list, and returns a new list', () => {
        const single = new FirstStrategy();
        const list = addStrategyToList(single, new SecondStrategy());
        expect(names(list)).toEqual(['first', 'second']);
        expect(names(addStrategyToList(list, new ThirdStrategy()))).toEqual(['first', 'second', 'third']);
        expect(names(list)).toEqual(['first', 'second']);
    });

    it('does not add a second entry of the same class', () => {
        const list = addStrategyToList([new FirstStrategy()], new SecondStrategy());
        expect(addStrategyToList(list, new SecondStrategy())).toBe(list);
    });
});

describe('sortStrategyList()', () => {
    it('sorts by priority, and plain entries have the priority 0 and keep their order', () => {
        let list: ActiveOrderStrategy[] = [new FirstStrategy(), new SecondStrategy()];
        list = addStrategyToList(list, new ThirdStrategy(), { priority: -10 });
        expect(names(sortStrategyList(list))).toEqual(['third', 'first', 'second']);
    });

    it('applies a removal to an entry that is added later, and keeps the removal record', () => {
        let list = removeStrategyFromList([new FirstStrategy()], SecondStrategy);
        list = addStrategyToList(list, new SecondStrategy(), { priority: -10 });
        const sorted = sortStrategyList(list);
        expect(names(sorted)).toEqual(['first']);
        expect(names(sortStrategyList(addStrategyToList(sorted, new SecondStrategy())))).toEqual(['first']);
    });
});

describe('removeStrategyFromList()', () => {
    it('adds a removal record that is a valid entry and finds no order', async () => {
        const list = removeStrategyFromList(new FirstStrategy(), FirstStrategy);
        const marker = list[1];
        expect(marker).toBeInstanceOf(RemovedStrategyListEntry);
        await expect(marker.determineActiveOrder(RequestContext.empty(), {})).resolves.toBeUndefined();
        expect(marker.createActiveOrder).toBeUndefined();
        expect(marker.defineInputType).toBeUndefined();
        expect(removeStrategyFromList(list, FirstStrategy)).toBe(list);
    });
});
