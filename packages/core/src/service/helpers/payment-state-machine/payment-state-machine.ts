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
import { Payment } from '../../../entity/payment/payment.entity';

import { PaymentState, PaymentTransitionData } from './payment-state';

@Injectable()
export class PaymentStateMachine {
    private readonly config: StateMachineConfig<PaymentState, PaymentTransitionData>;
    private readonly initialState: PaymentState = 'Created';

    constructor(private configService: ConfigService) {
        this.config = this.initConfig();
    }

    getInitialState(): PaymentState {
        return this.initialState;
    }

    canTransition(currentState: PaymentState, newState: PaymentState): boolean {
        return new FSM(this.config, currentState).canTransitionTo(newState);
    }

    getNextStates(payment: Payment): readonly PaymentState[] {
        const fsm = new FSM(this.config, payment.state);
        return fsm.getNextStates();
    }

    async transition(ctx: RequestContext, order: Order, payment: Payment, state: PaymentState) {
        const fsm = new FSM(this.config, payment.state);
        const result = await fsm.transitionTo(state, { ctx, order, payment });
        payment.state = state;
        return result;
    }

    private initConfig(): StateMachineConfig<PaymentState, PaymentTransitionData> {
        const { paymentMethodHandlers } = this.configService.paymentOptions;
        const customProcesses = this.configService.paymentOptions.customPaymentProcess ?? [];
        const processes = [...customProcesses, ...(this.configService.paymentOptions.process ?? [])];
        const allTransitions = processes.reduce(
            (transitions, process) =>
                mergeTransitionDefinitions(transitions, process.transitions as Transitions<any>),
            {} as Transitions<PaymentState>,
        );

        const validationResult = validateTransitionDefinition(allTransitions, this.initialState);
        if (!validationResult.valid && validationResult.error) {
            Logger.error(`The payment process has an invalid configuration:`);
            throw new Error(validationResult.error);
        }
        if (validationResult.valid && validationResult.error) {
            Logger.warn(`Payment process: ${validationResult.error}`);
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
                for (const handler of paymentMethodHandlers) {
                    if (data.payment.method === handler.code) {
                        const result = await awaitPromiseOrObservable(
                            handler.onStateTransitionStart(fromState, toState, data),
                        );
                        if (result !== true) {
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
                throw new IllegalOperationError(message || 'error.cannot-transition-payment-from-to', {
                    fromState,
                    toState,
                });
            },
        };
    }
}
