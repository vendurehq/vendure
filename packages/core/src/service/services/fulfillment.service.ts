import { Injectable } from '@nestjs/common';
import { ConfigurableOperationInput, OrderLineInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { isObject } from '@vendure/common/lib/shared-utils';
import { unique } from '@vendure/common/lib/unique';
import { In, Not } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { EntityNotFoundError } from '../../common/error/errors';
import {
    CreateFulfillmentError,
    FulfillmentStateTransitionError,
    InvalidFulfillmentHandlerError,
} from '../../common/error/generated-graphql-admin-errors';
import { Instrument } from '../../common/instrument-decorator';
import { idsAreEqual } from '../../common/utils';
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

    /**
     * @description
     * Loads the FulfillmentLines of a Fulfillment by id with no Channel check. Fulfillment is not
     * ChannelAware, so its only Channel boundary is the parent Order, and a caller must load that
     * Order in the current Channel first.
     *
     * This is safe for the core callers, the `Fulfillment.lines` and `Fulfillment.summary` field
     * resolvers, because neither takes an id from the client: a Fulfillment is reachable only
     * through `Order.fulfillments` or `FulfillmentLine.fulfillment`, and neither API has a root
     * Fulfillment query. Scoping the read was considered and rejected, because it adds a joined
     * Order query per Fulfillment per request on both APIs to guard a path no client can reach.
     * Add the check here if a root Fulfillment query is introduced.
     */
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
                .leftJoinAndSelect('order.channels', 'orderChannel')
                .where('line.id IN (:...lineIds)', { lineIds: orderLinesIds })
                .getMany();
            // Fulfillment is not ChannelAware, so the owning Orders are its only Channel boundary.
            // A transition creates stock movements, so without this check an administrator scoped
            // to one Channel can change another Channel's stock levels. The length check is not
            // redundant: Array.every returns true for an empty array, so a Fulfillment with no
            // owning Order would pass the Channel test. The Channels come from the join above, so
            // this costs no extra query.
            const ownedByActiveChannel =
                0 < orders.length &&
                orders.every(order =>
                    order.channels.some(channel => idsAreEqual(channel.id, txCtx.channelId)),
                );
            if (!ownedByActiveChannel) {
                throw new EntityNotFoundError('Fulfillment', fulfillmentId);
            }
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
