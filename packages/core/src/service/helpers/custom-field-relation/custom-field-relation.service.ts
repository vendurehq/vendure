import { Injectable } from '@nestjs/common';
import { pick } from '@vendure/common/lib/pick';
import { ID, Type } from '@vendure/common/lib/shared-types';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';

import { RequestContext } from '../../../api/common/request-context';
import { EntityNotFoundError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import {
    CustomFieldConfig,
    CustomFields,
    HasCustomFields,
    RelationCustomFieldConfig,
} from '../../../config/custom-field/custom-field-types';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { VendureEntity } from '../../../entity/base/base.entity';

import { getRelationTargetScope } from './relation-target-scope';

@Injectable()
export class CustomFieldRelationService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
    ) {}

    /**
     * @description
     * If the entity being created or updated has any custom fields of type `relation`, this
     * method will get the values from the input object and persist those relations in the
     * database.
     */
    async updateRelations<T extends HasCustomFields & VendureEntity>(
        ctx: RequestContext,
        entityType: Type<T>,
        input: { customFields?: { [key: string]: any } },
        entity: T,
    ) {
        if (input.customFields) {
            const relationCustomFields = this.configService.customFields[
                entityType.name as keyof CustomFields
            ].filter(this.isRelationalType);

            for (const field of relationCustomFields) {
                const inputIdName = getGraphQlInputName(field);
                const idOrIds = input.customFields[inputIdName];
                if (idOrIds !== undefined) {
                    let relations: VendureEntity | VendureEntity[] | undefined | null;
                    if (idOrIds === null) {
                        // an explicitly `null` value means remove the relation
                        relations = null;
                    } else if (field.list && Array.isArray(idOrIds) && idOrIds.every(id => this.isId(id))) {
                        relations = await this.findTargetsOrThrow(ctx, field, idOrIds, false);
                    } else if (!field.list && this.isId(idOrIds)) {
                        relations = (await this.findTargetsOrThrow(ctx, field, [idOrIds], false))[0];
                    }
                    if (relations !== undefined) {
                        const entityWithCustomFields = await this.connection
                            .getRepository(ctx, entityType)
                            .findOne({ where: { id: entity.id } as any, loadEagerRelations: false });
                        entity.customFields = {
                            ...entity.customFields,
                            ...entityWithCustomFields?.customFields,
                            [field.name]: relations,
                            // The relation id column must always be kept in sync with the relation
                            // itself, otherwise a stale id value would conflict with the relation
                            // when persisting, since both map to the same database column.
                            ...(field.list
                                ? {}
                                : {
                                      [`${field.name}Id`]:
                                          relations && !Array.isArray(relations) ? relations.id : null,
                                  }),
                        };
                        await this.connection
                            .getRepository(ctx, entityType)
                            .save(pick(entity, ['id', 'customFields']) as any, { reload: false });
                    }
                }
            }
        }
        return entity;
    }

    /**
     * @description
     * Throws an {@link EntityNotFoundError} if any of the given ids does not belong to an entity
     * of the type the relation custom field points at. If that type is ChannelAware, the entity
     * must also be assigned to the active Channel. `null` and `undefined` pass, since they clear or
     * leave alone the relation.
     *
     * Without this check, an unknown id on a single relation fails as a raw foreign key error from
     * the database, an unknown id in a list relation is silently dropped, and a relation can link
     * to an entity of a Channel the caller has no access to.
     */
    async assertRelationsExist(
        ctx: RequestContext,
        field: RelationCustomFieldConfig,
        idOrIds: ID | ID[] | null | undefined,
    ): Promise<void> {
        if (idOrIds == null) {
            return;
        }
        const ids = (Array.isArray(idOrIds) ? idOrIds : [idOrIds]).filter(id => this.isId(id));
        if (ids.length === 0) {
            return;
        }
        await this.findTargetsOrThrow(ctx, field, ids, true);
    }

    /**
     * Loads the target entities with the given ids, limited to the active Channel if the target is
     * ChannelAware, and throws an {@link EntityNotFoundError} for the first id which matches none. One query either way, so checking the ids costs nothing
     * extra where the entities are needed anyway.
     */
    private async findTargetsOrThrow(
        ctx: RequestContext,
        field: RelationCustomFieldConfig,
        ids: ID[],
        idsOnly: boolean,
    ): Promise<VendureEntity[]> {
        if (ids.length === 0) {
            return [];
        }
        const qb = this.connection
            .getRepository(ctx, field.entity)
            .createQueryBuilder('target')
            .where('target.id IN (:...ids)', { ids });
        if (idsOnly) {
            qb.select('target.id');
        }
        if (getRelationTargetScope(this.connection.rawConnection, field.entity).channelAware) {
            qb.innerJoin('target.channels', 'target_channel', 'target_channel.id = :channelId', {
                channelId: ctx.channelId,
            });
        }
        const found = await qb.getMany();
        const missing = ids.find(id => !found.some(entity => idsAreEqual(entity.id, id)));
        if (missing !== undefined) {
            throw new EntityNotFoundError(field.entity.name, missing);
        }
        return found;
    }

    private isRelationalType(this: void, input: CustomFieldConfig): input is RelationCustomFieldConfig {
        return input.type === 'relation';
    }

    private isId(input: unknown): input is ID {
        return typeof input === 'string' || typeof input === 'number';
    }
}
