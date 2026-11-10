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
            const relationCustomFields = this.configService.customFields[entityType.name as keyof CustomFields]
                .filter(this.isRelationalType)
                .filter(field => !field.channelScoped);

            for (const field of relationCustomFields) {
                const inputIdName = getGraphQlInputName(field);
                const idOrIds = input.customFields[inputIdName];
                if (idOrIds !== undefined) {
                    let relations: VendureEntity | VendureEntity[] | undefined | null;
                    if (idOrIds === null) {
                        // an explicitly `null` value means remove the relation
                        relations = null;
                    } else if (field.list && Array.isArray(idOrIds) && idOrIds.every(id => this.isId(id))) {
                        relations = await this.connection
                            .getRepository(ctx, field.entity)
                            .findBy({ id: In(idOrIds) });
                    } else if (!field.list && this.isId(idOrIds)) {
                        relations = await this.connection
                            .getRepository(ctx, field.entity)
                            .findOne({ where: { id: idOrIds } });
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
     * Channel-scoped custom fields are stored on the entity's channel assignment row, so their
     * input values are written to the row of the active Channel.
     */
    private async updateChannelScopedFields(
        ctx: RequestContext,
        entityType: Type<any>,
        customFieldsInput: { [key: string]: any },
        entity: VendureEntity,
    ) {
        const channelScoped = (this.configService.customFields[entityType.name as keyof CustomFields] ?? []).filter(
            field => field.channelScoped,
        );
        if (!channelScoped.length) {
            return;
        }
        const values: Record<string, unknown> = {};
        for (const field of channelScoped) {
            if (this.isRelationalType(field)) {
                const idOrIds = customFieldsInput[getGraphQlInputName(field)];
                if (idOrIds === undefined) {
                    continue;
                }
                if (idOrIds === null) {
                    values[field.name] = field.list ? [] : null;
                } else if (field.list && Array.isArray(idOrIds)) {
                    values[field.name] = await this.connection
                        .getRepository(ctx, field.entity)
                        .findBy({ id: In(idOrIds) });
                } else if (this.isId(idOrIds)) {
                    values[field.name] = await this.connection
                        .getRepository(ctx, field.entity)
                        .findOne({ where: { id: idOrIds } });
                }
            } else if (customFieldsInput[field.name] !== undefined) {
                values[field.name] = customFieldsInput[field.name];
            }
        }
        await this.channelAssignmentService.updateCustomFields(ctx, entityType, entity.id, ctx.channelId, values);
    }

    private isRelationalType(this: void, input: CustomFieldConfig): input is RelationCustomFieldConfig {
        return input.type === 'relation';
    }

    private isId(input: unknown): input is ID {
        return typeof input === 'string' || typeof input === 'number';
    }
}
