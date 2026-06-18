import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../api/common/request-context';
import { IllegalOperationError } from '../../../common/error/errors';
import { FSM } from '../../../common/finite-state-machine/finite-state-machine';
import { mergeTransitionDefinitions } from '../../../common/finite-state-machine/merge-transition-definitions';
import { StateMachineConfig, Transitions } from '../../../common/finite-state-machine/types';
import { validateTransitionDefinition } from '../../../common/finite-state-machine/validate-transition-definition';
import { awaitPromiseOrObservable } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { Fulfillment } from '../../../entity/fulfillment/fulfillment.entity';
import { Order } from '../../../entity/order/order.entity';

import { FulfillmentState, FulfillmentTransitionData } from './fulfillment-state';

@Injectable()
export class FulfillmentStateMachine {
    readonly config: StateMachineConfig<FulfillmentState, FulfillmentTransitionData>;
    private readonly initialState: FulfillmentState = 'Created';

    constructor(private configService: ConfigService) {
        this.config = this.initConfig();
    }

    getInitialState(): FulfillmentState {
        return this.initialState;
    }

    canTransition(currentState: FulfillmentState, newState: FulfillmentState): boolean {
        return new FSM(this.config, currentState).canTransitionTo(newState);
    }

    getNextStates(fulfillment: Fulfillment): readonly FulfillmentState[] {
        const fsm = new FSM(this.config, fulfillment.state);
        return fsm.getNextStates();
    }

    async transition(
        ctx: RequestContext,
        fulfillment: Fulfillment,
        orders: Order[],
        state: FulfillmentState,
    ) {
        const fsm = new FSM(this.config, fulfillment.state);
        const result = await fsm.transitionTo(state, { ctx, orders, fulfillment });
        fulfillment.state = fsm.currentState;
        return result;
    }

    private initConfig(): StateMachineConfig<FulfillmentState, FulfillmentTransitionData> {
        // TODO: remove once the customFulfillmentProcess option is removed
        const customProcesses = this.configService.shippingOptions.customFulfillmentProcess ?? [];
        const processes = [...customProcesses, ...(this.configService.shippingOptions.process ?? [])];
        const allTransitions = processes.reduce(
            (transitions, process) =>
                mergeTransitionDefinitions(transitions, process.transitions as Transitions<any>),
            {} as Transitions<FulfillmentState>,
        );

        const validationResult = validateTransitionDefinition(allTransitions, this.initialState);
        if (!validationResult.valid && validationResult.error) {
            Logger.error(`The fulfillment process has an invalid configuration:`);
            throw new Error(validationResult.error);
        }
        if (validationResult.valid && validationResult.error) {
            Logger.warn(`Fulfillment process: ${validationResult.error}`);
        }
        return {
            transitions: allTransitions,
            onTransitionStart: async (fromState, toState, data) => {
                for (const process of processes) {
                    if (typeof process.onTransitionStart === 'function') {
                        const result = await awaitPromiseOrObservable(
                            process.onTransitionStart(fromState, toState, data),
                        );
                        if (result === false || typeof result === 'string') {
                            return result;
                        }
                    }
                }
            },
            onTransitionEnd: async (fromState, toState, data) => {
                for (const process of processes) {
                    if (typeof process.onTransitionEnd === 'function') {
                        await awaitPromiseOrObservable(process.onTransitionEnd(fromState, toState, data));
                    }
                }
            },
            onError: async (fromState, toState, message) => {
                for (const process of processes) {
                    if (typeof process.onTransitionError === 'function') {
                        await awaitPromiseOrObservable(
                            process.onTransitionError(fromState, toState, message),
                        );
                    }
                }
                throw new IllegalOperationError(message || 'error.cannot-transition-fulfillment-from-to', {
                    fromState,
                    toState,
                });
            },
        };
    }
}
