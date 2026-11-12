import { describe, expect, it } from 'vitest';

import { Injector } from '../../common/injector';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

import {
    composeStrategy,
    getBaseStrategy,
    removeLayer,
    replaceBase,
    setLayerPriority,
} from './compose-strategy';
import { StrategyLayer } from './strategy-layer';

interface GreetingStrategy extends InjectableStrategy {
    greet(name: string): string[];
    farewell(name: string): string;
    shout?(name: string): string;
    punctuation?: string;
}

class BaseGreeting implements GreetingStrategy {
    punctuation = '!';
    constructor(private readonly label = 'base') {}
    greet(name: string) {
        return [`${this.label}:${name}`];
    }
    farewell(name: string) {
        return `bye ${name}${this.punctuation}`;
    }
}

class LoudGreeting extends BaseGreeting {
    shout(name: string) {
        return name.toUpperCase();
    }
}

function prependLayer(label: string, priority: number) {
    return class extends StrategyLayer.passThrough<GreetingStrategy>() {
        static priority = priority;
        greet(name: string) {
            return [label, ...this.inner.greet(name)];
        }
    };
}

const Layer100 = prependLayer('100', 100);
const Layer200 = prependLayer('200', 200);
const Layer300 = prependLayer('300', 300);

class SuffixLayer extends StrategyLayer.passThrough<GreetingStrategy, { suffix: string }>() {
    static priority = 150;
    greet(name: string) {
        return [...this.inner.greet(name), this.options.suffix];
    }
}

describe('composeStrategy()', () => {
    it('orders the layers by priority, whatever the order of the arguments', () => {
        const base = new BaseGreeting();
        expect(composeStrategy<GreetingStrategy>(Layer300, Layer100, Layer200, base).greet('a')).toEqual([
            '100',
            '200',
            '300',
            'base:a',
        ]);
        const stepwise = composeStrategy<GreetingStrategy>(
            Layer100,
            composeStrategy<GreetingStrategy>(Layer300, composeStrategy<GreetingStrategy>(Layer200, base)),
        );
        expect(stepwise.greet('a')).toEqual(['100', '200', '300', 'base:a']);
    });

    it('keeps the order of addition for layers with equal priorities', () => {
        const First = prependLayer('first', 100);
        const Second = prependLayer('second', 100);
        expect(composeStrategy<GreetingStrategy>(Second, First, new BaseGreeting()).greet('a')).toEqual([
            'second',
            'first',
            'base:a',
        ]);
    });

    it('applies a layer class one time, and the first options win', () => {
        const once = composeStrategy<GreetingStrategy>(SuffixLayer.with({ suffix: 'first' }), new BaseGreeting());
        const twice = composeStrategy<GreetingStrategy>(SuffixLayer.with({ suffix: 'second' }), once);
        expect(twice).toBe(once);
        expect(twice.greet('a')).toEqual(['base:a', 'first']);
    });

    it('returns the same object when no layer is added', () => {
        const composed = composeStrategy<GreetingStrategy>(Layer100, new BaseGreeting());
        expect(composeStrategy<GreetingStrategy>(Layer100, composed)).toBe(composed);
        const plain = new BaseGreeting();
        expect(composeStrategy<GreetingStrategy>(plain)).toBe(plain);
    });

    it('does not change the chain that it gets', () => {
        const first = composeStrategy<GreetingStrategy>(Layer100, new BaseGreeting());
        const second = composeStrategy<GreetingStrategy>(Layer200, first);
        expect(first.greet('a')).toEqual(['100', 'base:a']);
        expect(second.greet('a')).toEqual(['100', '200', 'base:a']);
    });

    it('uses the priority from with()', () => {
        const composed = composeStrategy<GreetingStrategy>(
            Layer100,
            Layer200,
            SuffixLayer.with({ suffix: 's' }, { priority: 50 }),
            new BaseGreeting(),
        );
        expect(composed.greet('a')).toEqual(['100', '200', 'base:a', 's']);
        const Outer = prependLayer('outer', 300);
        expect(
            composeStrategy<GreetingStrategy>(Layer100, Outer.with(undefined, { priority: 1 }), new BaseGreeting()).greet('a'),
        ).toEqual(['outer', '100', 'base:a']);
    });

    it('throws if a layer class has no priority', () => {
        class NoPriority extends StrategyLayer.passThrough<GreetingStrategy>() {}
        expect(() => composeStrategy<GreetingStrategy>(NoPriority, new BaseGreeting())).toThrow(
            'The strategy layer "NoPriority" has no priority',
        );
    });
});

describe('pass-through', () => {
    it('sends a method that the layer does not define to the inner strategy', () => {
        const composed = composeStrategy<GreetingStrategy>(Layer100, Layer200, new BaseGreeting());
        expect(composed.farewell('a')).toBe('bye a!');
    });

    it('has an optional method only if the inner strategy has it', () => {
        expect('shout' in composeStrategy<GreetingStrategy>(Layer100, new BaseGreeting())).toBe(false);
        expect(composeStrategy<GreetingStrategy>(Layer100, new LoudGreeting()).shout?.('a')).toBe('A');
    });

    it('reads a data member of the inner strategy, and an assignment gives the layer its own value', () => {
        const base = new BaseGreeting();
        const composed = composeStrategy<GreetingStrategy>(Layer100, base);
        expect(composed.punctuation).toBe('!');
        base.punctuation = '?';
        expect(composed.punctuation).toBe('?');
        composed.punctuation = '.';
        expect(composed.punctuation).toBe('.');
        expect(base.punctuation).toBe('?');
    });

    it('calls the methods of the inner strategy with the inner strategy as `this`', () => {
        const composed = composeStrategy<GreetingStrategy>(Layer100, new BaseGreeting('custom'));
        expect(composed.greet('a')).toEqual(['100', 'custom:a']);
    });
});

describe('members of the composed strategy', () => {
    class MemberStrategy implements GreetingStrategy {
        readonly code = 'member-code';
        private readonly prefix = 'hello';
        get description() {
            return `${this.prefix} from ${this.code}`;
        }
        greet(name: string) {
            return [`${this.prefix} ${name}`];
        }
        farewell() {
            return this === base ? 'this is the base' : 'this is not the base';
        }
    }
    const base = new MemberStrategy();
    const composed = composeStrategy<GreetingStrategy>(Layer100, Layer200, base) as GreetingStrategy & MemberStrategy;

    it('gives the value of a plain property of the base', () => {
        expect(composed.code).toBe(base.code);
    });

    it('gives the value of a getter of the base', () => {
        expect(composed.description).toBe('hello from member-code');
    });

    it('does not have an optional method that the base does not define', () => {
        expect(typeof composed.shout).toBe('undefined');
        expect('shout' in composed).toBe(false);
    });

    it('calls a method of the base with the base as `this`', () => {
        expect(composed.farewell()).toBe('this is the base');
        expect(composed.greet('a')).toEqual(['100', '200', 'hello a']);
    });
});

describe('removeLayer()', () => {
    it('removes a layer that is added later', () => {
        const removed = removeLayer<GreetingStrategy>(new BaseGreeting(), Layer200);
        const composed = composeStrategy<GreetingStrategy>(Layer100, Layer200, Layer300, removed);
        expect(composed.greet('a')).toEqual(['100', '300', 'base:a']);
    });

    it('removes a layer that is already in the chain', () => {
        const composed = composeStrategy<GreetingStrategy>(Layer100, Layer200, new BaseGreeting());
        expect(removeLayer<GreetingStrategy>(composed, Layer100).greet('a')).toEqual(['200', 'base:a']);
    });

    it('keeps the removal when a layer is composed again', () => {
        const removed = removeLayer<GreetingStrategy>(composeStrategy<GreetingStrategy>(Layer100, new BaseGreeting()), Layer100);
        expect(composeStrategy<GreetingStrategy>(Layer100, removed).greet('a')).toEqual(['base:a']);
    });
});

describe('setLayerPriority()', () => {
    it('changes the priority of a layer that is added later, and keeps its options', () => {
        const prioritised = setLayerPriority<GreetingStrategy>(new BaseGreeting(), SuffixLayer, 250);
        const composed = composeStrategy<GreetingStrategy>(Layer100, Layer200, SuffixLayer.with({ suffix: 's' }), prioritised);
        expect(composed.greet('a')).toEqual(['100', '200', 'base:a', 's']);
        expect(setLayerPriority<GreetingStrategy>(prioritised, SuffixLayer, 50) === prioritised).toBe(false);
    });

    it('rejects a priority that is not a finite number', () => {
        expect(() => setLayerPriority<GreetingStrategy>(new BaseGreeting(), Layer100, NaN)).toThrow(
            'A priority must be a finite number',
        );
    });

    it('does not add the layer', () => {
        expect(setLayerPriority<GreetingStrategy>(new BaseGreeting(), Layer100, 1).greet('a')).toEqual(['base:a']);
    });

    it('replaces the priority from with()', () => {
        const prioritised = setLayerPriority<GreetingStrategy>(new BaseGreeting(), Layer100, 500);
        const composed = composeStrategy<GreetingStrategy>(Layer100.with(undefined, { priority: 1 }), Layer200, prioritised);
        expect(composed.greet('a')).toEqual(['200', '100', 'base:a']);
    });
});

describe('replaceBase()', () => {
    it('changes the base and keeps the layers', () => {
        const composed = composeStrategy<GreetingStrategy>(Layer100, Layer200, new BaseGreeting());
        const replaced = replaceBase(composed, new BaseGreeting('other'));
        expect(replaced.greet('a')).toEqual(['100', '200', 'other:a']);
        expect(composed.greet('a')).toEqual(['100', '200', 'base:a']);
    });

    it('keeps the removals', () => {
        const removed = removeLayer<GreetingStrategy>(new BaseGreeting(), Layer100);
        const replaced = replaceBase(removed, new BaseGreeting('other'));
        expect(composeStrategy<GreetingStrategy>(Layer100, replaced).greet('a')).toEqual(['other:a']);
    });

    it('keeps the recorded priorities', () => {
        const prioritised = setLayerPriority<GreetingStrategy>(new BaseGreeting(), Layer100, 250);
        const replaced = replaceBase(prioritised, new BaseGreeting('other'));
        expect(composeStrategy<GreetingStrategy>(Layer100, Layer200, replaced).greet('a')).toEqual(['200', '100', 'other:a']);
    });

    it('returns the new base if the strategy is not composed', () => {
        const other = new BaseGreeting('other');
        expect(replaceBase<GreetingStrategy>(new BaseGreeting(), other)).toBe(other);
    });
});

describe('getBaseStrategy()', () => {
    it('returns the base of a composed strategy', () => {
        const base = new BaseGreeting();
        expect(getBaseStrategy(composeStrategy<GreetingStrategy>(Layer100, Layer200, base))).toBe(base);
        expect(getBaseStrategy(removeLayer<GreetingStrategy>(base, Layer100))).toBe(base);
    });

    it('returns a strategy that is not composed', () => {
        const base = new BaseGreeting();
        expect(getBaseStrategy(base)).toBe(base);
    });
});

describe('lifecycle', () => {
    const delay = () => new Promise(resolve => setTimeout(resolve, 5));
    const testInjector = {} as Injector;

    function lifecycleLayer(label: string, priority: number, calls: string[]) {
        return class extends StrategyLayer.passThrough<GreetingStrategy>() {
            static priority = priority;
            async init(injector: Injector) {
                await delay();
                calls.push(`init ${label}${injector === testInjector ? ' with injector' : ''}`);
            }
            async destroy() {
                await delay();
                calls.push(`destroy ${label}`);
            }
        };
    }

    it('initialises the base and then each layer from the inside out, and destroys in reverse', async () => {
        const calls: string[] = [];
        const base = new BaseGreeting();
        Object.assign(base, {
            init: async (injector: Injector) => {
                await delay();
                calls.push(`init base${injector === testInjector ? ' with injector' : ''}`);
            },
            destroy: async () => {
                await delay();
                calls.push('destroy base');
            },
        });
        const composed = composeStrategy<GreetingStrategy>(
            lifecycleLayer('outer', 100, calls),
            lifecycleLayer('inner', 200, calls),
            base,
        );

        await composed.init?.(testInjector);
        await composed.destroy?.();

        expect(calls).toEqual([
            'init base with injector',
            'init inner with injector',
            'init outer with injector',
            'destroy outer',
            'destroy inner',
            'destroy base',
        ]);
    });

    it('does not send init() or destroy() of a layer without them to the inner strategy', async () => {
        let initCount = 0;
        const base = new BaseGreeting();
        Object.assign(base, { init: () => initCount++ });
        const composed = composeStrategy<GreetingStrategy>(Layer100, Layer200, base);
        await composed.init?.({} as Injector);
        expect(initCount).toBe(1);
    });
});
