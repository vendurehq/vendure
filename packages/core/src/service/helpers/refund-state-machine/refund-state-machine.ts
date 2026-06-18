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
import { Order } from '../../../entity/order/order.entity';
import { Refund } from '../../../entity/refund/refund.entity';

import { RefundState, RefundTransitionData } from './refund-state';

@Injectable()
export class RefundStateMachine {
    private readonly config: StateMachineConfig<RefundState, RefundTransitionData>;
    private readonly initialState: RefundState = 'Pending';

    constructor(private configService: ConfigService) {
        this.config = this.initConfig();
    }

    getInitialState(): RefundState {
        return this.initialState;
    }

    getNextStates(refund: Refund): readonly RefundState[] {
        const fsm = new FSM(this.config, refund.state);
        return fsm.getNextStates();
    }

    async transition(ctx: RequestContext, order: Order, refund: Refund, state: RefundState) {
        const fsm = new FSM(this.config, refund.state);
        const result = await fsm.transitionTo(state, { ctx, order, refund });
        refund.state = state;
        return result;
    }

    private initConfig(): StateMachineConfig<RefundState, RefundTransitionData> {
        const processes = [...(this.configService.paymentOptions.refundProcess ?? [])];
        const allTransitions = processes.reduce(
            (transitions, process) =>
                mergeTransitionDefinitions(transitions, process.transitions as Transitions<any>),
            {} as Transitions<RefundState>,
        );

        const validationResult = validateTransitionDefinition(allTransitions, this.initialState);
        if (!validationResult.valid && validationResult.error) {
            Logger.error(`The refund process has an invalid configuration:`);
            throw new Error(validationResult.error);
        }
        if (validationResult.valid && validationResult.error) {
            Logger.warn(`Refund process: ${validationResult.error}`);
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
                throw new IllegalOperationError(message || 'error.cannot-transition-refund-from-to', {
                    fromState,
                    toState,
                });
            },
        };
    }
}
