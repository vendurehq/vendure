import {
    OnTransitionEndFn,
    OnTransitionErrorFn,
    OnTransitionStartFn,
    Transitions,
} from '../../common/finite-state-machine/types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import {
    RefundState,
    RefundStates,
    RefundTransitionData,
} from '../../service/helpers/refund-state-machine/refund-state';

/**
 * @description
 * A RefundProcess is used to define the way the refund process works as in: what states a Refund can be
 * in, and how it may transition from one state to another. Using the `onTransitionStart()` hook, a
 * RefundProcess can perform checks before allowing a state transition to occur, and the `onTransitionEnd()`
 * hook allows logic to be executed after a state change.
 *
 * For detailed description of the interface members, see the {@link StateMachineConfig} docs.
 *
 * @docsCategory payment
 */
export interface RefundProcess<State extends keyof RefundStates | string> extends InjectableStrategy {
    transitions?: Transitions<State, State | RefundState> & Partial<Transitions<RefundState | State>>;
    onTransitionStart?: OnTransitionStartFn<State | RefundState, RefundTransitionData>;
    onTransitionEnd?: OnTransitionEndFn<State | RefundState, RefundTransitionData>;
    onTransitionError?: OnTransitionErrorFn<State | RefundState>;
}
