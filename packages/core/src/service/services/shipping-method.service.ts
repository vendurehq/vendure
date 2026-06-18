import { Injectable } from '@nestjs/common';
import {
    AssignShippingMethodsToChannelInput,
    ConfigurableOperationDefinition,
    CreateShippingMethodInput,
    DeletionResponse,
    DeletionResult,
    Permission,
    RemoveShippingMethodsFromChannelInput,
    UpdateShippingMethodInput,
} from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { EntityNotFoundError, ForbiddenError, UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ShippingMethodTranslation } from '../../entity/shipping-method/shipping-method-translation.entity';
import { ShippingMethod } from '../../entity/shipping-method/shipping-method.entity';
import { EventBus } from '../../event-bus';
import { ShippingMethodEvent } from '../../event-bus/events/shipping-method-event';
import { ConfigArgService } from '../helpers/config-arg/config-arg.service';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

import { ChannelService } from './channel.service';
import { RoleService } from './role.service';

/**
 * @description
 * Contains methods relating to {@link ShippingMethod} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class ShippingMethodService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private roleService: RoleService,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private configArgService: ConfigArgService,
        private translatableSaver: TranslatableSaver,
        private customFieldRelationService: CustomFieldRelationService,
        private eventBus: EventBus,
        private translator: TranslatorService,
    ) {}

    /** @internal */
    async initShippingMethods() {
        if (this.configService.shippingOptions.fulfillmentHandlers.length === 0) {
            throw new Error(
                'No FulfillmentHandlers were found.' +
                    ' Please ensure the VendureConfig.shippingOptions.fulfillmentHandlers array contains at least one FulfillmentHandler.',
            );
        }
        await this.verifyShippingMethods();
    }

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<ShippingMethod>,
        relations: RelationPaths<ShippingMethod> = [],
    ): Promise<PaginatedList<Translated<ShippingMethod>>> {
        return this.listQueryBuilder
            .build(ShippingMethod, options, {
                relations,
                where: { deletedAt: IsNull() },
                channelId: ctx.channelId,
                ctx,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items: items.map(i => this.translator.translate(i, ctx)),
                totalItems,
            }));
    }

    async findOne(
        ctx: RequestContext,
        shippingMethodId: ID,
        includeDeleted = false,
        relations: RelationPaths<ShippingMethod> = [],
    ): Promise<Translated<ShippingMethod> | undefined> {
        const shippingMethod = await this.connection.findOneInChannel(
            ctx,
            ShippingMethod,
            shippingMethodId,
            ctx.channelId,
            {
                relations,
                ...(includeDeleted === false ? { where: { deletedAt: IsNull() } } : {}),
            },
        );
        return (shippingMethod && this.translator.translate(shippingMethod, ctx)) ?? undefined;
    }

    async create(ctx: RequestContext, input: CreateShippingMethodInput): Promise<Translated<ShippingMethod>> {
        const shippingMethod = await this.translatableSaver.create({
            ctx,
            input,
            entityType: ShippingMethod,
            translationType: ShippingMethodTranslation,
            beforeSave: method => {
                method.fulfillmentHandlerCode = this.ensureValidFulfillmentHandlerCode(
                    method.code,
                    input.fulfillmentHandler,
                );
                method.checker = this.configArgService.parseInput(
                    'ShippingEligibilityChecker',
                    input.checker,
                );
                method.calculator = this.configArgService.parseInput('ShippingCalculator', input.calculator);
            },
        });
        await this.channelService.assignToCurrentChannel(shippingMethod, ctx);
        const newShippingMethod = await this.connection
            .getRepository(ctx, ShippingMethod)
            .save(shippingMethod);
        const shippingMethodWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            ShippingMethod,
            input,
            newShippingMethod,
        );
        await this.eventBus.publish(
            new ShippingMethodEvent(ctx, shippingMethodWithRelations, 'created', input),
        );
        return assertFound(this.findOne(ctx, newShippingMethod.id));
    }

    async update(ctx: RequestContext, input: UpdateShippingMethodInput): Promise<Translated<ShippingMethod>> {
        const shippingMethod = await this.findOne(ctx, input.id);
        if (!shippingMethod) {
            throw new EntityNotFoundError('ShippingMethod', input.id);
        }
        const updatedShippingMethod = await this.translatableSaver.update({
            ctx,
            input: omit(input, ['checker', 'calculator']),
            entityType: ShippingMethod,
            translationType: ShippingMethodTranslation,
        });
        if (input.checker) {
            updatedShippingMethod.checker = this.configArgService.parseInput(
                'ShippingEligibilityChecker',
                input.checker,
            );
        }
        if (input.calculator) {
            updatedShippingMethod.calculator = this.configArgService.parseInput(
                'ShippingCalculator',
                input.calculator,
            );
        }
        if (input.fulfillmentHandler) {
            updatedShippingMethod.fulfillmentHandlerCode = this.ensureValidFulfillmentHandlerCode(
                updatedShippingMethod.code,
                input.fulfillmentHandler,
            );
        }
        await this.customFieldRelationService.updateRelations(
            ctx,
            ShippingMethod,
            input,
            updatedShippingMethod,
        );
        await this.connection
            .getRepository(ctx, ShippingMethod)
            .save(updatedShippingMethod, { reload: false });
        await this.eventBus.publish(new ShippingMethodEvent(ctx, updatedShippingMethod, 'updated', input));
        return assertFound(this.findOne(ctx, shippingMethod.id));
    }

    async softDelete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const shippingMethod = await this.connection.getEntityOrThrow(ctx, ShippingMethod, id, {
            channelId: ctx.channelId,
            where: { deletedAt: IsNull() },
        });
        shippingMethod.deletedAt = new Date();
        await this.connection.getRepository(ctx, ShippingMethod).save(shippingMethod, { reload: false });
        await this.eventBus.publish(new ShippingMethodEvent(ctx, shippingMethod, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    async assignShippingMethodsToChannel(
        ctx: RequestContext,
        input: AssignShippingMethodsToChannelInput,
    ): Promise<Array<Translated<ShippingMethod>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.UpdateShippingMethod,
            Permission.UpdateSettings,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        for (const shippingMethodId of input.shippingMethodIds) {
            const shippingMethod = await this.connection.findOneInChannel(
                ctx,
                ShippingMethod,
                shippingMethodId,
                ctx.channelId,
            );
            await this.channelService.assignToChannels(ctx, ShippingMethod, shippingMethodId, [
                input.channelId,
            ]);
        }
        return this.connection
            .findByIdsInChannel(ctx, ShippingMethod, input.shippingMethodIds, ctx.channelId, {})
            .then(methods => methods.map(method => this.translator.translate(method, ctx)));
    }

    async removeShippingMethodsFromChannel(
        ctx: RequestContext,
        input: RemoveShippingMethodsFromChannelInput,
    ): Promise<Array<Translated<ShippingMethod>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.DeleteShippingMethod,
            Permission.DeleteSettings,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(input.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        for (const shippingMethodId of input.shippingMethodIds) {
            const shippingMethod = await this.connection.getEntityOrThrow(
                ctx,
                ShippingMethod,
                shippingMethodId,
            );
            await this.channelService.removeFromChannels(ctx, ShippingMethod, shippingMethodId, [
                input.channelId,
            ]);
        }
        return this.connection
            .findByIdsInChannel(ctx, ShippingMethod, input.shippingMethodIds, ctx.channelId, {})
            .then(methods => methods.map(method => this.translator.translate(method, ctx)));
    }

    getShippingEligibilityCheckers(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService
            .getDefinitions('ShippingEligibilityChecker')
            .map(x => x.toGraphQlType(ctx));
    }

    getShippingCalculators(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService.getDefinitions('ShippingCalculator').map(x => x.toGraphQlType(ctx));
    }

    getFulfillmentHandlers(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService.getDefinitions('FulfillmentHandler').map(x => x.toGraphQlType(ctx));
    }

    async getActiveShippingMethods(ctx: RequestContext): Promise<ShippingMethod[]> {
        const shippingMethods = await this.connection.getRepository(ctx, ShippingMethod).find({
            relations: ['channels', 'customFields'],
            where: { deletedAt: IsNull() },
        });
        return shippingMethods
            .filter(sm => sm.channels.find(c => idsAreEqual(c.id, ctx.channelId)))
            .map(m => this.translator.translate(m, ctx));
    }

    /**
     * Ensures that all ShippingMethods have a valid fulfillmentHandlerCode
     */
    private async verifyShippingMethods() {
        const activeShippingMethods = await this.connection.rawConnection.getRepository(ShippingMethod).find({
            where: { deletedAt: IsNull() },
        });
        for (const method of activeShippingMethods) {
            const handlerCode = method.fulfillmentHandlerCode;
            const verifiedHandlerCode = this.ensureValidFulfillmentHandlerCode(method.code, handlerCode);
            if (handlerCode !== verifiedHandlerCode) {
                method.fulfillmentHandlerCode = verifiedHandlerCode;
                await this.connection.rawConnection.getRepository(ShippingMethod).save(method);
            }
        }
    }

    private ensureValidFulfillmentHandlerCode(
        shippingMethodCode: string,
        fulfillmentHandlerCode: string,
    ): string {
        const { fulfillmentHandlers } = this.configService.shippingOptions;
        let handler = fulfillmentHandlers.find(h => h.code === fulfillmentHandlerCode);
        if (!handler) {
            handler = fulfillmentHandlers[0];
            Logger.error(
                `The ShippingMethod "${shippingMethodCode}" references an invalid FulfillmentHandler.\n` +
                    `The FulfillmentHandler with code "${fulfillmentHandlerCode}" was not found. Using "${handler.code}" instead.`,
            );
        }
        return handler.code;
    }
}
