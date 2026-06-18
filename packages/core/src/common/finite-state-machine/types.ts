import { Observable } from 'rxjs';

/**
 * @description
 * A type which is used to define valid states and transitions for a state machine based
 * on {@link FSM}.
 *
 * @example
 * ```ts
 * type LightColor = 'Green' | 'Amber' | 'Red';
 *
 * const trafficLightTransitions: Transitions<LightColor> = {
 *   Green: {
 *     to: ['Amber'],
 *   },
 *   Amber: {
 *     to: ['Red'],
 *   },
 *   Red: {
 *     to: ['Green'],
 *   },
 * };
 * ```
 *
 * The `mergeStrategy` property defines how to handle the merging of states when one set of
 * transitions is being merged with another (as in the case of defining a {@link OrderProcess})
 *
 * @docsCategory StateMachine
 */
export type Transitions<State extends string, Target extends string = State> = {
    [S in State]: {
        to: Readonly<Target[]>;
        mergeStrategy?: 'merge' | 'replace';
    };
};

/**
 * @description
 * Called before a transition takes place. If the function resolves to `false` or a string, then the transition
 * will be cancelled. In the case of a string, the string (error message) will be forwarded to the onError handler.
 *
 * If this function returns a value resolving to `true` or `void` (no return value), then the transition
 * will be permitted.
 *
 * @docsCategory StateMachine
 * @docsPage StateMachineConfig
 */
export type OnTransitionStartFn<T extends string, Data> = (
    fromState: T,
    toState: T,
    data: Data,
) => boolean | string | void | Promise<boolean | string | void> | Observable<boolean | string | void>;

/**
 * @description
 * Called when a transition is prevented and the `onTransitionStart` handler has returned an
 * error message.
 *
 * @docsCategory StateMachine
 * @docsPage StateMachineConfig
 */
export type OnTransitionErrorFn<T extends string> = (
    fromState: T,
    toState: T,
    message?: string,
) => void | Promise<void> | Observable<void>;

/**
 * @description
 * Called after a transition has taken place.
 *
 * @docsCategory StateMachine
 * @docsPage StateMachineConfig
 */
export type OnTransitionEndFn<T extends string, Data> = (
    fromState: T,
    toState: T,
    data: Data,
) => void | Promise<void> | Observable<void>;

/**
 * @description
 * The config object used to instantiate a new {@link FSM} instance.
 *
 * @docsCategory StateMachine
 * @docsPage StateMachineConfig
 * @docsWeight 0
 */
export interface StateMachineConfig<T extends string, Data = undefined> {
    /**
     * @description
     * Defines the available states of the state machine as well as the permitted
     * transitions from one state to another.
     */
    readonly transitions: Transitions<T>;

    /**
     * @description
     * Called before a transition takes place. If the function resolves to `false` or a string, then the transition
     * will be cancelled. In the case of a string, the string (error message) will be forwarded to the onError handler.
     *
     * If this function returns a value resolving to `true` or `void` (no return value), then the transition
     * will be permitted.
     */
    onTransitionStart?: OnTransitionStartFn<T, Data>;

    /**
     * @description
     * Called after a transition has taken place.
     */
    onTransitionEnd?: OnTransitionEndFn<T, Data>;

    /**
     * @description
     * Called when a transition is prevented and the `onTransitionStart` handler has returned an
     * error message.
     */
    onError?: OnTransitionErrorFn<T>;
}
