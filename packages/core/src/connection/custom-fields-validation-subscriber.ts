import { Injectable } from '@nestjs/common';
import { EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm';

import { ConfigService } from '../config/config.service';
import { CustomFields, HasCustomFields } from '../config/custom-field/custom-field-types';
import { Logger } from '../config/logger/vendure-logger';

import { TransactionalConnection } from './transactional-connection';

@Injectable()
export class CustomFieldsValidationSubscriber implements EntitySubscriberInterface {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
    ) {
        connection.rawConnection.subscribers.push(this);
    }

    validateCustomFields(entityName: string, entity: Partial<HasCustomFields>) {
        const cf: any = (entity as any).customFields;
        if (cf === null || cf === undefined || typeof cf !== 'object') {
            return;
        }

        const config = this.resolveCustomFieldsConfig(entityName);
        if (!config || config.length === 0) {
            return;
        }
        const validFieldNames = new Set(config.map(field => field.name));
        for (const key of Object.keys(cf)) {
            if (!validFieldNames.has(key)) {
                Logger.warn(`Custom field ${key} not found for entity ${entityName}`);
            }
        }
    }

    private resolveCustomFieldsConfig(entityName: string) {
        let cfg = this.configService.customFields[entityName as keyof CustomFields];
        if (!cfg && entityName.endsWith('Translation')) {
            const base = entityName.slice(0, -'Translation'.length);
            cfg = this.configService.customFields[base as keyof CustomFields];
        }
        return cfg;
    }

    beforeInsert(event: InsertEvent<any>) {
        if (event.entity === undefined) {
            return;
        }

        const entityName = event.entity.constructor.name;
        this.validateCustomFields(entityName, event.entity);
    }

    beforeUpdate(event: UpdateEvent<any>) {
        if (event.entity === undefined) {
            return;
        }

        const entityName = event.entity.constructor.name;
        this.validateCustomFields(entityName, event.entity);
    }
}
