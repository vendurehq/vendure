import {
    OnTransitionEndFn,
    OnTransitionErrorFn,
    OnTransitionStartFn,
    StateMachineConfig,
    Transitions,
} from '../../common/finite-state-machine/types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import {
    CustomOrderStates,
    OrderState,
    OrderTransitionData,
} from '../../service/helpers/order-state-machine/order-state';

/**
 * @description
 * An OrderProcess is used to define the way the order process works as in: what states an Order can be
 * in, and how it may transition from one state to another. Using the `onTransitionStart()` hook, an
 * OrderProcess can perform checks before allowing a state transition to occur, and the `onTransitionEnd()`
 * hook allows logic to be executed after a state change.
 *
 * For detailed description of the interface members, see the {@link StateMachineConfig} docs.
 *
 * :::info
 *
 * This is configured via the `orderOptions.process` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory orders
 * @docsPage OrderProcess
 * @docsWeight 0
 */
export interface OrderProcess<State extends keyof CustomOrderStates | string> extends InjectableStrategy {
    transitions?: Transitions<State, State | OrderState> & Partial<Transitions<OrderState | State>>;
    onTransitionStart?: OnTransitionStartFn<State | OrderState, OrderTransitionData>;
    onTransitionEnd?: OnTransitionEndFn<State | OrderState, OrderTransitionData>;
    onTransitionError?: OnTransitionErrorFn<State | OrderState>;
}

/**
 * @description
 * Used to define extensions to or modifications of the default order process.
 *
 * @deprecated Use OrderProcess
 */
export interface CustomOrderProcess<State extends keyof CustomOrderStates | string>
    extends OrderProcess<State> {}
