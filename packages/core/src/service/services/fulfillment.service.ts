import { Injectable } from '@nestjs/common';
import { ConfigurableOperationInput, OrderLineInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { isObject } from '@vendure/common/lib/shared-utils';
import { unique } from '@vendure/common/lib/unique';
import { In, Not } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import {
    CreateFulfillmentError,
    FulfillmentStateTransitionError,
    InvalidFulfillmentHandlerError,
} from '../../common/error/generated-graphql-admin-errors';
import { Instrument } from '../../common/instrument-decorator';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Fulfillment } from '../../entity/fulfillment/fulfillment.entity';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { FulfillmentLine } from '../../entity/order-line-reference/fulfillment-line.entity';
import { EventBus } from '../../event-bus/event-bus';
import { FulfillmentEvent } from '../../event-bus/events/fulfillment-event';
import { FulfillmentStateTransitionEvent } from '../../event-bus/events/fulfillment-state-transition-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { FulfillmentState } from '../helpers/fulfillment-state-machine/fulfillment-state';
import { FulfillmentStateMachine } from '../helpers/fulfillment-state-machine/fulfillment-state-machine';
/**
 * @description
 * Contains methods relating to {@link Fulfillment} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class FulfillmentService {
    constructor(
        private connection: TransactionalConnection,
        private fulfillmentStateMachine: FulfillmentStateMachine,
        private eventBus: EventBus,
        private configService: ConfigService,
        private customFieldRelationService: CustomFieldRelationService,
    ) {}

    /**
     * @description
     * Creates a new Fulfillment for the given Orders and OrderItems, using the specified
     * {@link FulfillmentHandler}.
     */
    async create(
        ctx: RequestContext,
        orders: Order[],
        lines: OrderLineInput[],
        handler: ConfigurableOperationInput,
    ): Promise<Fulfillment | InvalidFulfillmentHandlerError | CreateFulfillmentError> {
        const fulfillmentHandler = this.configService.shippingOptions.fulfillmentHandlers.find(
            h => h.code === handler.code,
        );
        if (!fulfillmentHandler) {
            return new InvalidFulfillmentHandlerError();
        }
        let fulfillmentPartial;
        try {
            fulfillmentPartial = await fulfillmentHandler.createFulfillment(
                ctx,
                orders,
                lines,
                handler.arguments,
            );
        } catch (e: unknown) {
            let message = 'No error message';
            if (isObject(e)) {
                message = (e as any).message || e.toString();
            }
            return new CreateFulfillmentError({ fulfillmentHandlerError: message });
        }

        const orderLines = await this.connection
            .getRepository(ctx, OrderLine)
            .find({ where: { id: In(lines.map(l => l.orderLineId)) } });

        const newFulfillment = await this.connection.getRepository(ctx, Fulfillment).save(
            new Fulfillment({
                method: '',
                trackingCode: '',
                ...fulfillmentPartial,
                lines: [],
                state: this.fulfillmentStateMachine.getInitialState(),
                handlerCode: fulfillmentHandler.code,
            }),
        );
        const fulfillmentLines: FulfillmentLine[] = [];
        for (const { orderLineId, quantity } of lines) {
            const fulfillmentLine = await this.connection.getRepository(ctx, FulfillmentLine).save(
                new FulfillmentLine({
                    orderLineId,
                    quantity,
                }),
            );
            fulfillmentLines.push(fulfillmentLine);
        }
        await this.connection
            .getRepository(ctx, Fulfillment)
            .createQueryBuilder()
            .relation('lines')
            .of(newFulfillment)
            .add(fulfillmentLines);
        const fulfillmentWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            Fulfillment,
            fulfillmentPartial,
            newFulfillment,
        );
        await this.eventBus.publish(
            new FulfillmentEvent(ctx, fulfillmentWithRelations, {
                orders,
                lines,
                handler,
            }),
        );
        return newFulfillment;
    }

    async getFulfillmentLines(ctx: RequestContext, id: ID): Promise<FulfillmentLine[]> {
        return this.connection
            .getEntityOrThrow(ctx, Fulfillment, id, {
                relations: ['lines'],
            })
            .then(fulfillment => fulfillment.lines);
    }

    async getFulfillmentsLinesForOrderLine(
        ctx: RequestContext,
        orderLineId: ID,
        relations: RelationPaths<FulfillmentLine> = [],
    ): Promise<FulfillmentLine[]> {
        const defaultRelations = ['fulfillment'];
        return this.connection.getRepository(ctx, FulfillmentLine).find({
            relations: Array.from(new Set([...defaultRelations, ...relations])),
            where: {
                fulfillment: {
                    state: Not('Cancelled'),
                },
                orderLineId,
            },
        });
    }

    /**
     * @description
     * Transitions the specified Fulfillment to a new state and upon successful transition
     * publishes a {@link FulfillmentStateTransitionEvent}.
     */
    async transitionToState(
        ctx: RequestContext,
        fulfillmentId: ID,
        state: FulfillmentState,
    ): Promise<
        | {
              fulfillment: Fulfillment;
              orders: Order[];
              fromState: FulfillmentState;
              toState: FulfillmentState;
          }
        | FulfillmentStateTransitionError
    > {
        // Wrapped in withTransaction so the state save and onTransitionEnd hooks
        // are atomic — see the equivalent comment on OrderService.transitionToState.
        // #4686.
        return this.connection.withTransaction(ctx, async txCtx => {
            const fulfillment = await this.connection.getEntityOrThrow(
                txCtx,
                Fulfillment,
                fulfillmentId,
                { relations: ['lines'] },
            );
            const orderLinesIds = unique(fulfillment.lines.map(lines => lines.orderLineId));
            const orders = await this.connection
                .getRepository(txCtx, Order)
                .createQueryBuilder('order')
                .leftJoinAndSelect('order.lines', 'line')
                .where('line.id IN (:...lineIds)', { lineIds: orderLinesIds })
                .getMany();
            const fromState = fulfillment.state;
            let finalize: () => Promise<any>;
            try {
                const result = await this.fulfillmentStateMachine.transition(
                    txCtx,
                    fulfillment,
                    orders,
                    state,
                );
                finalize = result.finalize;
            } catch (e: any) {
                const transitionError = txCtx.translate(e.message, { fromState, toState: state });
                return new FulfillmentStateTransitionError({ transitionError, fromState, toState: state });
            }
            await this.connection.getRepository(txCtx, Fulfillment).save(fulfillment, { reload: false });
            await this.eventBus.publish(
                new FulfillmentStateTransitionEvent(fromState, state, txCtx, fulfillment),
            );
            await finalize();
            return { fulfillment, orders, fromState, toState: state };
        });
    }

    /**
     * @description
     * Returns an array of the next valid states for the Fulfillment.
     */
    getNextStates(fulfillment: Fulfillment): readonly FulfillmentState[] {
        return this.fulfillmentStateMachine.getNextStates(fulfillment);
    }
}
