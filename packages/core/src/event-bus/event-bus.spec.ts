import { firstValueFrom, Subject } from 'rxjs';
import { QueryRunner } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from './event-bus';
import { VendureEvent } from './vendure-event';

class MockTransactionSubscriber {
    awaitRelease(queryRunner: QueryRunner): Promise<QueryRunner> {
        return Promise.resolve(queryRunner);
    }
}

describe('EventBus', () => {
    let eventBus: EventBus;

    beforeEach(() => {
        eventBus = new EventBus(new MockTransactionSubscriber() as any);
    });

    it('can publish without subscribers', () => {
        const event = new TestEvent('foo');

        expect(async () => await eventBus.publish(event)).not.toThrow();
    });

    describe('ofType()', () => {
        it('single handler is called once', async () => {
            const handler = vi.fn();
            const event = new TestEvent('foo');
            eventBus.ofType(TestEvent).subscribe(handler);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(event);
        });

        it('single handler is called on multiple events', async () => {
            const handler = vi.fn();
            const event1 = new TestEvent('foo');
            const event2 = new TestEvent('bar');
            const event3 = new TestEvent('baz');
            eventBus.ofType(TestEvent).subscribe(handler);

            await eventBus.publish(event1);
            await eventBus.publish(event2);
            await eventBus.publish(event3);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalledTimes(3);
            expect(handler).toHaveBeenCalledWith(event1);
            expect(handler).toHaveBeenCalledWith(event2);
            expect(handler).toHaveBeenCalledWith(event3);
        });

        it('multiple handler are called', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const handler3 = vi.fn();
            const event = new TestEvent('foo');
            eventBus.ofType(TestEvent).subscribe(handler1);
            eventBus.ofType(TestEvent).subscribe(handler2);
            eventBus.ofType(TestEvent).subscribe(handler3);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler1).toHaveBeenCalledWith(event);
            expect(handler2).toHaveBeenCalledWith(event);
            expect(handler3).toHaveBeenCalledWith(event);
        });

        it('handler is not called for other events', async () => {
            const handler = vi.fn();
            const event = new OtherTestEvent('foo');
            eventBus.ofType(TestEvent).subscribe(handler);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).not.toHaveBeenCalled();
        });

        it('ofType() returns a subscription', async () => {
            const handler = vi.fn();
            const event = new TestEvent('foo');
            const subscription = eventBus.ofType(TestEvent).subscribe(handler);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalledTimes(1);

            subscription.unsubscribe();

            await eventBus.publish(event);
            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('unsubscribe() only unsubscribes own handler', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const event = new TestEvent('foo');
            const subscription1 = eventBus.ofType(TestEvent).subscribe(handler1);
            const subscription2 = eventBus.ofType(TestEvent).subscribe(handler2);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);

            subscription1.unsubscribe();

            await eventBus.publish(event);
            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(3);
        });
    });

    describe('filter()', () => {
        it('single handler is called once', async () => {
            const handler = vi.fn();
            const event = new TestEvent('foo');
            eventBus.filter(vendureEvent => vendureEvent instanceof TestEvent).subscribe(handler);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(event);
        });

        it('single handler is called on multiple events', async () => {
            const handler = vi.fn();
            const event1 = new TestEvent('foo');
            const event2 = new TestEvent('bar');
            const event3 = new TestEvent('baz');
            eventBus.filter(vendureEvent => vendureEvent instanceof TestEvent).subscribe(handler);

            await eventBus.publish(event1);
            await eventBus.publish(event2);
            await eventBus.publish(event3);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalledTimes(3);
            expect(handler).toHaveBeenCalledWith(event1);
            expect(handler).toHaveBeenCalledWith(event2);
            expect(handler).toHaveBeenCalledWith(event3);
        });

        it('multiple handler are called', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const handler3 = vi.fn();
            const event = new TestEvent('foo');
            eventBus.filter(vendureEvent => vendureEvent instanceof TestEvent).subscribe(handler1);
            eventBus.filter(vendureEvent => vendureEvent instanceof TestEvent).subscribe(handler2);
            eventBus.filter(vendureEvent => vendureEvent instanceof TestEvent).subscribe(handler3);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler1).toHaveBeenCalledWith(event);
            expect(handler2).toHaveBeenCalledWith(event);
            expect(handler3).toHaveBeenCalledWith(event);
        });

        it('handler is not called for other events', async () => {
            const handler = vi.fn();
            const event = new OtherTestEvent('foo');
            eventBus.filter(vendureEvent => vendureEvent instanceof TestEvent).subscribe(handler);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).not.toHaveBeenCalled();
        });

        it('handler is called for instance of child classes', async () => {
            const handler = vi.fn();
            const event = new ChildTestEvent('bar', 'foo');
            eventBus.filter(vendureEvent => vendureEvent instanceof TestEvent).subscribe(handler);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalled();
        });

        it('filter() returns a subscription', async () => {
            const handler = vi.fn();
            const event = new TestEvent('foo');
            const subscription = eventBus
                .filter(vendureEvent => vendureEvent instanceof TestEvent)
                .subscribe(handler);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalledTimes(1);

            subscription.unsubscribe();

            await eventBus.publish(event);
            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('unsubscribe() only unsubscribes own handler', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const event = new TestEvent('foo');
            const subscription1 = eventBus
                .filter(vendureEvent => vendureEvent instanceof TestEvent)
                .subscribe(handler1);
            const subscription2 = eventBus
                .filter(vendureEvent => vendureEvent instanceof TestEvent)
                .subscribe(handler2);

            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);

            subscription1.unsubscribe();

            await eventBus.publish(event);
            await eventBus.publish(event);
            await new Promise(resolve => setImmediate(resolve));

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(3);
        });
    });

    describe('blocking event handlers', () => {
        it('calls the handler function', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((e: VendureEvent) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy(e),
                id: 'test-handler',
                event: TestEvent,
            });

            await eventBus.publish(event);

            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith(event);
        });

        it('throws when attempting to register with a duplicate id', () => {
            eventBus.registerBlockingEventHandler({
                handler: e => undefined,
                id: 'test-handler',
                event: TestEvent,
            });
            expect(() => {
                eventBus.registerBlockingEventHandler({
                    handler: e => undefined,
                    id: 'test-handler',
                    event: TestEvent,
                });
            }).toThrowError(
                'A handler with the id "test-handler" is already registered for the event TestEvent',
            );
        });

        it('calls multiple handler functions', async () => {
            const event = new TestEvent('foo');
            const spy1 = vi.fn((e: VendureEvent) => undefined);
            const spy2 = vi.fn((e: VendureEvent) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy1(e),
                id: 'test-handler1',
                event: TestEvent,
            });
            eventBus.registerBlockingEventHandler({
                handler: e => spy2(e),
                id: 'test-handler2',
                event: TestEvent,
            });

            await eventBus.publish(event);

            expect(spy1).toHaveBeenCalledTimes(1);
            expect(spy1).toHaveBeenCalledWith(event);
            expect(spy2).toHaveBeenCalledTimes(1);
            expect(spy2).toHaveBeenCalledWith(event);
        });

        it('handles multiple events', async () => {
            const event1 = new TestEvent('foo');
            const event2 = new OtherTestEvent('bar');
            const spy = vi.fn((e: VendureEvent) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy(e),
                id: 'test-handler',
                event: [TestEvent, OtherTestEvent],
            });

            await eventBus.publish(event1);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith(event1);

            await eventBus.publish(event2);
            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveBeenCalledWith(event2);
        });

        it('publish method throws in a handler throws', async () => {
            const event = new TestEvent('foo');
            eventBus.registerBlockingEventHandler({
                handler: () => {
                    throw new Error('test error');
                },
                id: 'test-handler',
                event: TestEvent,
            });

            await expect(eventBus.publish(event)).rejects.toThrow('test error');
        });

        it('order of execution with "before" property', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler1'),
                id: 'test-handler1',
                event: TestEvent,
            });
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler2'),
                id: 'test-handler2',
                event: TestEvent,
                before: 'test-handler1',
            });

            await eventBus.publish(event);

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveBeenNthCalledWith(1, 'test-handler2');
            expect(spy).toHaveBeenNthCalledWith(2, 'test-handler1');
        });

        it('order of execution with "after" property', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler1'),
                id: 'test-handler1',
                event: TestEvent,
                after: 'test-handler2',
            });
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler2'),
                id: 'test-handler2',
                event: TestEvent,
            });

            await eventBus.publish(event);

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveBeenNthCalledWith(1, 'test-handler2');
            expect(spy).toHaveBeenNthCalledWith(2, 'test-handler1');
        });

        it('orders handlers which declare "after" on one side and "before" on the other', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler1'),
                id: 'test-handler1',
                event: TestEvent,
                after: 'test-handler2',
            });
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler2'),
                id: 'test-handler2',
                event: TestEvent,
                before: 'test-handler1',
            });

            await eventBus.publish(event);

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveBeenNthCalledWith(1, 'test-handler2');
            expect(spy).toHaveBeenNthCalledWith(2, 'test-handler1');
        });

        it('orders handlers which declare "before" on one side and "after" on the other', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler1'),
                id: 'test-handler1',
                event: TestEvent,
                before: 'test-handler2',
            });
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler2'),
                id: 'test-handler2',
                event: TestEvent,
                after: 'test-handler1',
            });

            await eventBus.publish(event);

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveBeenNthCalledWith(1, 'test-handler1');
            expect(spy).toHaveBeenNthCalledWith(2, 'test-handler2');
        });

        it('orders handlers which declare the same constraint on both sides, with the "before" side registered first', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler2'),
                id: 'test-handler2',
                event: TestEvent,
                before: 'test-handler1',
            });
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler1'),
                id: 'test-handler1',
                event: TestEvent,
                after: 'test-handler2',
            });

            await eventBus.publish(event);

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveBeenNthCalledWith(1, 'test-handler2');
            expect(spy).toHaveBeenNthCalledWith(2, 'test-handler1');
        });

        it('orders handlers which declare the same constraint on both sides among other handlers', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler3'),
                id: 'test-handler3',
                event: TestEvent,
            });
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler1'),
                id: 'test-handler1',
                event: TestEvent,
                after: 'test-handler2',
            });
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler2'),
                id: 'test-handler2',
                event: TestEvent,
                before: 'test-handler1',
            });

            await eventBus.publish(event);

            expect(spy.mock.calls.map(call => call[0])).toEqual([
                'test-handler3',
                'test-handler2',
                'test-handler1',
            ]);
        });

        it('throws if there is a cycle in before ordering', () => {
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler1'),
                id: 'test-handler1',
                event: TestEvent,
                before: 'test-handler2',
            });

            expect(() =>
                eventBus.registerBlockingEventHandler({
                    handler: e => spy('test-handler2'),
                    id: 'test-handler2',
                    event: TestEvent,
                    before: 'test-handler1',
                }),
            ).toThrowError(
                'Circular dependency detected between event handlers test-handler1 and test-handler2',
            );
        });

        it('throws if there is a cycle in after ordering', () => {
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: e => spy('test-handler1'),
                id: 'test-handler1',
                event: TestEvent,
                after: 'test-handler2',
            });

            expect(() =>
                eventBus.registerBlockingEventHandler({
                    handler: e => spy('test-handler2'),
                    id: 'test-handler2',
                    event: TestEvent,
                    after: 'test-handler1',
                }),
            ).toThrowError(
                'Circular dependency detected between event handlers test-handler1 and test-handler2',
            );
        });

        it('throws if there is a cycle of three handlers in after ordering', () => {
            eventBus.registerBlockingEventHandler({
                handler: () => undefined,
                id: 'A',
                event: TestEvent,
                after: 'B',
            });
            eventBus.registerBlockingEventHandler({
                handler: () => undefined,
                id: 'B',
                event: TestEvent,
                after: 'C',
            });

            const register = () =>
                eventBus.registerBlockingEventHandler({
                    handler: () => undefined,
                    id: 'C',
                    event: TestEvent,
                    after: 'A',
                });

            expect(register).toThrowError(
                /^Circular dependency detected between event handlers \w, \w and \w$/,
            );
            for (const id of ['A', 'B', 'C']) {
                expect(register).toThrowError(new RegExp(`handlers.*\\b${id}\\b`));
            }
        });

        it('throws if there is a cycle of three handlers in before ordering', () => {
            eventBus.registerBlockingEventHandler({
                handler: () => undefined,
                id: 'A',
                event: TestEvent,
                before: 'B',
            });
            eventBus.registerBlockingEventHandler({
                handler: () => undefined,
                id: 'B',
                event: TestEvent,
                before: 'C',
            });

            const register = () =>
                eventBus.registerBlockingEventHandler({
                    handler: () => undefined,
                    id: 'C',
                    event: TestEvent,
                    before: 'A',
                });

            expect(register).toThrowError(
                /^Circular dependency detected between event handlers \w, \w and \w$/,
            );
            for (const id of ['A', 'B', 'C']) {
                expect(register).toThrowError(new RegExp(`handlers.*\\b${id}\\b`));
            }
        });

        it('throws if a cycle mixes before and after', () => {
            eventBus.registerBlockingEventHandler({
                handler: () => undefined,
                id: 'B',
                event: TestEvent,
            });
            eventBus.registerBlockingEventHandler({
                handler: () => undefined,
                id: 'A',
                event: TestEvent,
                after: 'B',
                before: 'C',
            });

            expect(() =>
                eventBus.registerBlockingEventHandler({
                    handler: () => undefined,
                    id: 'C',
                    event: TestEvent,
                    before: 'B',
                }),
            ).toThrowError(/^Circular dependency detected between event handlers \w, \w and \w$/);
        });

        it('throws if a handler is ordered relative to itself', () => {
            expect(() =>
                eventBus.registerBlockingEventHandler({
                    handler: () => undefined,
                    id: 'A',
                    event: TestEvent,
                    after: 'A',
                }),
            ).toThrowError('Circular dependency detected between event handlers A and A');
        });

        it('orders a chain of three handlers without a cycle', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: () => spy('A'),
                id: 'A',
                event: TestEvent,
                after: 'B',
            });
            eventBus.registerBlockingEventHandler({
                handler: () => spy('B'),
                id: 'B',
                event: TestEvent,
                after: 'C',
            });
            eventBus.registerBlockingEventHandler({
                handler: () => spy('C'),
                id: 'C',
                event: TestEvent,
            });

            await eventBus.publish(event);

            expect(spy.mock.calls.map(call => call[0])).toEqual(['C', 'B', 'A']);
        });

        it('keeps the registered handlers when a registration is rejected', async () => {
            const event = new TestEvent('foo');
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: () => spy('A'),
                id: 'A',
                event: TestEvent,
                after: 'B',
            });
            expect(() =>
                eventBus.registerBlockingEventHandler({
                    handler: () => spy('B'),
                    id: 'B',
                    event: TestEvent,
                    after: 'A',
                }),
            ).toThrowError('Circular dependency detected');
            eventBus.registerBlockingEventHandler({
                handler: () => spy('C'),
                id: 'C',
                event: TestEvent,
            });

            await eventBus.publish(event);

            expect(spy.mock.calls.map(call => call[0])).toEqual(['A', 'C']);
        });

        it('keeps the registered handlers of every event when a multi-event registration is rejected', async () => {
            const spy = vi.fn((input: string) => undefined);
            eventBus.registerBlockingEventHandler({
                handler: () => spy('A'),
                id: 'A',
                event: OtherTestEvent,
                after: 'B',
            });
            expect(() =>
                eventBus.registerBlockingEventHandler({
                    handler: () => spy('B'),
                    id: 'B',
                    event: [TestEvent, OtherTestEvent],
                    after: 'A',
                }),
            ).toThrowError('Circular dependency detected');

            await eventBus.publish(new TestEvent('foo'));

            expect(spy).not.toHaveBeenCalled();
        });

        it('blocks execution of the publish method', async () => {
            const event = new TestEvent('foo');
            const subject = new Subject<void>();
            eventBus.registerBlockingEventHandler({
                handler: e => firstValueFrom(subject.asObservable()),
                id: 'test-handler',
                event: TestEvent,
            });
            const publishPromise = eventBus.publish(event);
            expect(publishPromise).toBeInstanceOf(Promise);

            let resolved = false;
            void publishPromise.then(() => (resolved = true));

            expect(resolved).toBe(false);
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(resolved).toBe(false);
            // Handler only resolves after the subject emits
            subject.next();
            // Allow the event loop to tick
            await new Promise(resolve => setTimeout(resolve, 0));
            // Now the promise should be resolved
            expect(resolved).toBe(true);
        });
    });
});

class TestEvent extends VendureEvent {
    constructor(public payload: string) {
        super();
    }
}

class ChildTestEvent extends TestEvent {
    constructor(
        public childPayload: string,
        payload: string,
    ) {
        super(payload);
    }
}

class OtherTestEvent extends VendureEvent {
    constructor(public payload: string) {
        super();
    }
}
