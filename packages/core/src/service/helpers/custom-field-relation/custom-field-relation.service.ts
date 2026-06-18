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

    private isRelationalType(this: void, input: CustomFieldConfig): input is RelationCustomFieldConfig {
        return input.type === 'relation';
    }

    private isId(input: unknown): input is ID {
        return typeof input === 'string' || typeof input === 'number';
    }
}
