import { Injectable } from '@nestjs/common';
import { pick } from '@vendure/common/lib/pick';
import { ID, Type } from '@vendure/common/lib/shared-types';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import { In } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { ConfigService } from '../../../config/config.service';
import {
    CustomFieldConfig,
    CustomFields,
    HasCustomFields,
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
                .filter(field => !field.channelScoped);

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
     * Writes the values of the entity's channel-scoped custom fields (see the `channelScoped`
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
        const channelScoped = (
            this.configService.customFields[entityType.name as keyof CustomFields] ?? []
        ).filter(field => field.channelScoped);
        if (!channelScoped.length || !customFieldsInput) {
            return;
        }
        const values: Record<string, unknown> = {};
        for (const field of channelScoped) {
            if (this.isRelationalType(field)) {
                const idOrIds = customFieldsInput[getGraphQlInputName(field)];
                if (idOrIds !== undefined) {
                    const relation = await this.resolveRelationInput(ctx, field, idOrIds);
                    if (relation !== undefined) {
                        values[field.name] = relation;
                    }
                }
            } else if (customFieldsInput[field.name] !== undefined) {
                values[field.name] = customFieldsInput[field.name];
            }
        }
        await this.channelAssignmentService.updateCustomFields(ctx, entityType, entity.id, channelId, values);
    }

    /**
     * Resolves the input of a relation custom field: `null` removes the relation, an id (or a list
     * of ids for `list` fields) loads the related entities, and input of the wrong shape is ignored
     * (`undefined`).
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
            return this.connection.getRepository(ctx, field.entity).findBy({ id: In(idOrIds) });
        }
        if (!field.list && this.isId(idOrIds)) {
            // An unknown id resolves to null, as before, which removes the relation
            return this.connection.getRepository(ctx, field.entity).findOne({ where: { id: idOrIds } });
        }
        return undefined;
    }

    private isRelationalType(this: void, input: CustomFieldConfig): input is RelationCustomFieldConfig {
        return input.type === 'relation';
    }

    private isId(input: unknown): input is ID {
        return typeof input === 'string' || typeof input === 'number';
    }
}
