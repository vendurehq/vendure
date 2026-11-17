import {
    OnTransitionEndFn,
    OnTransitionErrorFn,
    OnTransitionStartFn,
    Transitions,
} from '../../common/finite-state-machine/types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import {
    FulfillmentState,
    FulfillmentStates,
    FulfillmentTransitionData,
} from '../../service/helpers/fulfillment-state-machine/fulfillment-state';

/**
 * @description
 * A FulfillmentProcess is used to define the way the fulfillment process works as in: what states a Fulfillment can be
 * in, and how it may transition from one state to another. Using the `onTransitionStart()` hook, a
 * FulfillmentProcess can perform checks before allowing a state transition to occur, and the `onTransitionEnd()`
 * hook allows logic to be executed after a state change.
 *
 * For detailed description of the interface members, see the {@link StateMachineConfig} docs.
 *
 * @docsCategory fulfillment
 * @since 2.0.0
 */
export interface FulfillmentProcess<
    State extends keyof FulfillmentStates | string,
> extends InjectableStrategy {
    transitions?: Transitions<State, State | FulfillmentState> &
        Partial<Transitions<FulfillmentState | State>>;
    onTransitionStart?: OnTransitionStartFn<State | FulfillmentState, FulfillmentTransitionData>;
    onTransitionEnd?: OnTransitionEndFn<State | FulfillmentState, FulfillmentTransitionData>;
    onTransitionError?: OnTransitionErrorFn<State | FulfillmentState>;
}
