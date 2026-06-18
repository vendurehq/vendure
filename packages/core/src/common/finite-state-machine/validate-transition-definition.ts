import { Transitions } from './types';

type ValidationResult = { reachable: boolean };

/**
 * This function validates a finite state machine transition graph to ensure
 * that all states are reachable from the given initial state.
 */
export function validateTransitionDefinition<T extends string>(
    transitions: Transitions<T>,
    initialState: T,
): { valid: boolean; error?: string } {
    if (!transitions[initialState]) {
        return {
            valid: false,
            error: `The initial state "${initialState}" is not defined`,
        };
    }
    const states = Object.keys(transitions) as T[];
    const result: { [State in T]: ValidationResult } = states.reduce((res, state) => {
        return {
            ...res,
            [state]: { reachable: false },
        };
    }, {} as any);

    // walk the state graph starting with the initialState and
    // check whether all states are reachable.
    function allStatesReached(): boolean {
        return Object.values(result).every(r => (r as ValidationResult).reachable);
    }
    function walkGraph(state: T) {
        const candidates = transitions[state].to;
        result[state].reachable = true;
        if (allStatesReached()) {
            return true;
        }
        for (const candidate of candidates) {
            if (result[candidate] === undefined) {
                throw new Error(`The state "${state}" has a transition to an unknown state "${candidate}"`);
            }
            if (!result[candidate].reachable) {
                walkGraph(candidate);
            }
        }
    }
    try {
        walkGraph(initialState);
    } catch (e: any) {
        return {
            valid: false,
            error: e.message,
        };
    }

    const error = !allStatesReached()
        ? `The following states are unreachable: ${Object.entries(result)
              .filter(([s, v]) => !(v as ValidationResult).reachable)
              .map(([s]) => s)
              .join(', ')}`
        : undefined;

    return {
        valid: true,
        error,
    };
}
