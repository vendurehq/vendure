import {
    OnTransitionEndFn,
    OnTransitionErrorFn,
    OnTransitionStartFn,
    Transitions,
} from '../../common/finite-state-machine/types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import {
    CustomPaymentStates,
    PaymentState,
    PaymentTransitionData,
} from '../../service/helpers/payment-state-machine/payment-state';

/**
 * @description
 * A PaymentProcess is used to define the way the payment process works as in: what states a Payment can be
 * in, and how it may transition from one state to another. Using the `onTransitionStart()` hook, a
 * PaymentProcess can perform checks before allowing a state transition to occur, and the `onTransitionEnd()`
 * hook allows logic to be executed after a state change.
 *
 * For detailed description of the interface members, see the {@link StateMachineConfig} docs.
 *
 * :::info
 *
 * This is configured via the `paymentOptions.process` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory payment
 * @since 2.0.0
 */
export interface PaymentProcess<State extends keyof CustomPaymentStates | string> extends InjectableStrategy {
    transitions?: Transitions<State, State | PaymentState> & Partial<Transitions<PaymentState | State>>;
    onTransitionStart?: OnTransitionStartFn<State | PaymentState, PaymentTransitionData>;
    onTransitionEnd?: OnTransitionEndFn<State | PaymentState, PaymentTransitionData>;
    onTransitionError?: OnTransitionErrorFn<State | PaymentState>;
}

/**
 * @description
 * Used to define extensions to or modifications of the default payment process.
 *
 * For detailed description of the interface members, see the {@link StateMachineConfig} docs.
 *
 * @deprecated use PaymentProcess
 */
export interface CustomPaymentProcess<State extends keyof CustomPaymentStates | string>
    extends PaymentProcess<State> {}
