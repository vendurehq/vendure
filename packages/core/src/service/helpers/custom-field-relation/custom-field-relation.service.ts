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
    getChannelScopedCustomFields,
    HasCustomFields,
    isChannelScopedCustomField,
    RelationCustomFieldConfig,
} from '../../../config/custom-field/custom-field-types';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { VendureEntity } from '../../../entity/base/base.entity';
import { ChannelAssignmentService } from '../channel-assignment/channel-assignment.service';

@Injectable()
export class CustomFieldRelationService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private channelAssignmentService: ChannelAssignmentService,
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
            await this.updateChannelScopedFields(ctx, entityType, input.customFields, entity);
            const relationCustomFields = this.configService.customFields[
                entityType.name as keyof CustomFields
            ]
                .filter(this.isRelationalType)
                .filter(field => !isChannelScopedCustomField(field));

            for (const field of relationCustomFields) {
                const idOrIds = input.customFields[getGraphQlInputName(field)];
                if (idOrIds !== undefined) {
                    const relations = await this.resolveRelationInput(ctx, field, idOrIds);
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
     * Writes the values of the entity's channel-scoped custom fields (see the `scope`
     * custom field option) from `customFieldsInput` to its channel assignment row in the given
     * Channel (defaults to the active Channel). {@link updateRelations} calls this; services which save custom field input without
     * calling {@link updateRelations} must call it after the entity is assigned to the Channel.
     *
     * @since 4.0.0
     */
    async updateChannelScopedFields(
        ctx: RequestContext,
        entityType: Type<any>,
        customFieldsInput: { [key: string]: any } | undefined,
        entity: VendureEntity,
        channelId: ID = ctx.channelId,
    ) {
        const channelScoped = getChannelScopedCustomFields(this.configService.customFields, entityType.name);
        if (!channelScoped.length || !customFieldsInput) {
            return;
        }
        // Only the input's own properties: the input may be an entity's `customFields` object, on
        // which channel-scoped names are getters which throw (see guardChannelScopedCustomFields)
        const input = (key: string) =>
            Object.prototype.hasOwnProperty.call(customFieldsInput, key) ? customFieldsInput[key] : undefined;
        const values: Record<string, unknown> = {};
        for (const field of channelScoped) {
            if (this.isRelationalType(field)) {
                let idOrIds = input(getGraphQlInputName(field));
                const byName = input(field.name);
                if (idOrIds === undefined && byName !== undefined) {
                    // Keyed by the field name, as by the Importer: `{ id }` (or an entity), a list of
                    // them, or null
                    idOrIds = Array.isArray(byName)
                        ? byName.map((value: any) => value?.id ?? value)
                        : (byName?.id ?? byName);
                }
                if (idOrIds !== undefined) {
                    const relation = await this.resolveRelationInput(ctx, field, idOrIds);
                    if (relation !== undefined) {
                        values[field.name] = relation;
                    }
                }
            } else if (input(field.name) !== undefined) {
                values[field.name] = input(field.name);
            }
        }
        // The values which a save() through the TransactionalConnection already wrote are left out
        const toWrite = this.channelAssignmentService.withoutPersistedValues(ctx, entity, channelId, values);
        await this.channelAssignmentService.updateCustomFields(
            ctx,
            entityType,
            entity.id,
            channelId,
            toWrite,
        );
    }

    /**
     * Resolves the input of a relation custom field: `null` removes the relation, an id (or a list
     * of ids for `list` fields) loads the related entities, throwing an {@link EntityNotFoundError}
     * for an unknown id, and input of the wrong shape is ignored (`undefined`).
     */
    private async resolveRelationInput(
        ctx: RequestContext,
        field: RelationCustomFieldConfig,
        idOrIds: unknown,
    ): Promise<VendureEntity | VendureEntity[] | null | undefined> {
        if (idOrIds === null) {
            return null;
        }
        if (field.list && Array.isArray(idOrIds) && idOrIds.every(id => this.isId(id))) {
            return await this.findTargetsOrThrow(ctx, field, idOrIds, false);
        }
        if (!field.list && this.isId(idOrIds)) {
            // An unknown id throws an EntityNotFoundError
            return (await this.findTargetsOrThrow(ctx, field, [idOrIds], false))[0];
        }
        return undefined;
    }

    /**
     * @description
     * Throws an {@link EntityNotFoundError} if any of the given ids does not belong to an entity
     * of the type the relation custom field points at. `null` and `undefined` pass, since they
     * clear or leave alone the relation.
     *
     * Without this check, an unknown id on a single relation fails as a raw foreign key error from
     * the database, and an unknown id in a list relation is silently dropped.
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
     * Loads the target entities with the given ids, and throws an {@link EntityNotFoundError} for
     * the first id which matches none. One query either way, so checking the ids costs nothing
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
