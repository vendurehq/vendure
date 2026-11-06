import { Injectable } from '@nestjs/common';
import {
    DuplicateEntityInput,
    DuplicateEntityResult,
    EntityDuplicatorDefinition,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { EntityNotFoundError } from '../../../common/error/errors';
import { DuplicateEntityError } from '../../../common/error/generated-graphql-admin-errors';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { ConfigArgService } from '../config-arg/config-arg.service';
import { isChannelAwareMetadata } from '../utils/is-channel-aware-metadata';

/**
 * @description
 * This service is used to duplicate entities using one of the configured
 * {@link EntityDuplicator} functions.
 *
 * @docsCategory service-helpers
 * @since 2.2.0
 */
@Injectable()
export class EntityDuplicatorService {
    constructor(
        private configService: ConfigService,
        private configArgService: ConfigArgService,
        private connection: TransactionalConnection,
    ) {}

    /**
     * @description
     * Returns all configured {@link EntityDuplicator} definitions.
     */
    getEntityDuplicators(ctx: RequestContext): EntityDuplicatorDefinition[] {
        return this.configArgService.getDefinitions('EntityDuplicator').map(x => ({
            ...x.toGraphQlType(ctx),
            __typename: 'EntityDuplicatorDefinition',
            forEntities: x.forEntities,
            requiresPermission: x.requiresPermission,
        }));
    }

    /**
     * @description
     * Duplicates an entity using the specified {@link EntityDuplicator}. The duplication is performed
     * within a transaction, so if an error occurs, the transaction will be rolled back.
     */
    async duplicateEntity(ctx: RequestContext, input: DuplicateEntityInput): Promise<DuplicateEntityResult> {
        const duplicator = this.configService.entityOptions.entityDuplicators.find(
            s => s.forEntities.includes(input.entityName) && s.code === input.duplicatorInput.code,
        );
        if (!duplicator) {
            return new DuplicateEntityError({
                duplicationError: ctx.translate(`message.entity-duplication-no-strategy-found`, {
                    entityName: input.entityName,
                    code: input.duplicatorInput.code,
                }),
            });
        }

        // Check permissions
        if (
            duplicator.requiresPermission.length === 0 ||
            !ctx.userHasPermissions(duplicator.requiresPermission)
        ) {
            return new DuplicateEntityError({
                duplicationError: ctx.translate(`message.entity-duplication-no-permission`),
            });
        }

        const parsedInput = this.configArgService.parseInput('EntityDuplicator', input.duplicatorInput);

        return await this.connection.withTransaction(ctx, async innerCtx => {
            try {
                await this.assertSourceEntityIsInChannel(innerCtx, input.entityName, input.entityId);
                const newEntity = await duplicator.duplicate({
                    ctx: innerCtx,
                    entityName: input.entityName,
                    id: input.entityId,
                    args: parsedInput.args,
                });
                return { newEntityId: newEntity.id };
            } catch (e: any) {
                await this.connection.rollBackTransaction(innerCtx);
                Logger.error(e.message, undefined, e.stack);
                return new DuplicateEntityError({
                    duplicationError: e.message ?? e.toString(),
                });
            }
        });
    }

    /**
     * If the entity being duplicated is ChannelAware, then the source entity must belong to the
     * active Channel. Without this check, an Administrator with a Channel-scoped role could copy
     * an entity out of a Channel they have no access to. The built-in duplicators also scope their
     * own lookups, but a custom duplicator cannot be relied on to do so.
     */
    private async assertSourceEntityIsInChannel(ctx: RequestContext, entityName: string, id: ID) {
        const metadata = this.connection.rawConnection.entityMetadatas.find(m => m.name === entityName);
        if (!metadata || !isChannelAwareMetadata(metadata)) {
            return;
        }
        const existsInChannel = await this.connection
            .getRepository(ctx, metadata.target)
            .createQueryBuilder('entity')
            .leftJoin('entity.channels', 'channel')
            .where('entity.id = :id', { id })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
            .getExists();
        if (!existsInChannel) {
            throw new EntityNotFoundError(entityName, id);
        }
    }
}
