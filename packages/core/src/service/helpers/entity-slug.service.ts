import { Injectable } from '@nestjs/common';
import { EntityMetadata, ObjectLiteral, Repository } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common/error/errors';
import { TransactionalConnection } from '../../connection/transactional-connection';

import { SlugService } from './slug.service';

/**
 * @description
 * Parameters for entity slug generation
 */
export interface GenerateSlugFromInputParams {
    /**
     * The name of the entity (base entity, e.g., 'Product', 'Collection')
     */
    entityName: string;
    /**
     * The name of the field to check for uniqueness (e.g., 'slug', 'code')
     */
    fieldName: string;
    /**
     * The value to generate the slug from
     */
    inputValue: string;
    /**
     * Optional ID of the entity being updated
     */
    entityId?: string | number;
}

/**
 * @description
 * A service that handles slug generation for entities, ensuring uniqueness
 * and handling conflicts by appending numbers.
 *
 * @docsCategory services
 * @since 3.5.0
 */
@Injectable()
export class EntitySlugService {
    constructor(
        private slugService: SlugService,
        private connection: TransactionalConnection,
    ) {}

    /**
     * @description
     * Generates a slug from input value for an entity, ensuring uniqueness.
     * Automatically detects if the field exists on the base entity or its translation entity.
     *
     * @param ctx The request context
     * @param params Parameters for slug generation
     * @returns A unique slug string
     */
    async generateSlugFromInput(ctx: RequestContext, params: GenerateSlugFromInputParams): Promise<string> {
        const { entityName, fieldName, inputValue, entityId } = params;

        // Short-circuit for empty inputValue
        const baseSlug = await this.slugService.generate(ctx, {
            value: inputValue,
            entityName,
            fieldName,
        });

        if (!baseSlug) {
            return baseSlug;
        }

        const { entityMetadata, resolvedColumnName, isTranslationEntity, ownerRelationColumnName } =
            this.findEntityWithField(entityName, fieldName);

        const repository = this.connection.getRepository(ctx, entityMetadata.target);
        let slug = baseSlug;
        let counter = 1;

        const exclusionConfig =
            isTranslationEntity && entityId && ownerRelationColumnName
                ? { columnName: ownerRelationColumnName, value: entityId }
                : entityId
                  ? { columnName: 'id', value: entityId }
                  : undefined;

        while (await this.fieldValueExists(ctx, repository, resolvedColumnName, slug, exclusionConfig)) {
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        return slug;
    }

    /**
     * @description
     * Finds the entity metadata for the given entity name and field name.
     * If the field doesn't exist on the base entity, it checks the translation entity.
     *
     * @param entityName The base entity name
     * @param fieldName The field name to find
     * @returns Object containing entityMetadata, actualEntityName, resolvedColumnName, and isTranslationEntity
     */
    private findEntityWithField(
        entityName: string,
        fieldName: string,
    ): {
        entityMetadata: EntityMetadata;
        actualEntityName: string;
        resolvedColumnName: string;
        isTranslationEntity: boolean;
        ownerRelationColumnName?: string;
    } {
        // First, try to find the base entity
        const entityMetadata = this.connection.rawConnection.entityMetadatas.find(
            metadata => metadata.name === entityName,
        );

        if (!entityMetadata) {
            throw new UserInputError(`error.entity-not-found`, {
                entityName,
            });
        }

        // Check if the field exists on the base entity
        const baseEntityColumn = entityMetadata.columns.find(col => col.propertyName === fieldName);

        if (baseEntityColumn) {
            return {
                entityMetadata,
                actualEntityName: entityName,
                resolvedColumnName: baseEntityColumn.databaseName,
                isTranslationEntity: false,
            };
        }

        // If field doesn't exist on base entity, try to find the translation entity through relations
        const translationRelation = entityMetadata.relations.find(r => r.propertyName === 'translations');

        if (!translationRelation) {
            throw new UserInputError(`error.entity-has-no-field`, {
                entityName,
                fieldName,
            });
        }

        // Get the translation entity metadata from the relation
        const translationMetadata = this.connection.rawConnection.getMetadata(translationRelation.type);

        if (!translationMetadata) {
            throw new UserInputError(`error.entity-has-no-field`, {
                entityName,
                fieldName,
            });
        }

        const translationColumn = translationMetadata.columns.find(col => col.propertyName === fieldName);

        if (translationColumn) {
            // Find the owner relation column (e.g., 'baseId', 'productId', etc.)
            const ownerRelation = translationMetadata.relations.find(r => r.type === entityMetadata.target);
            const ownerColumnName = ownerRelation?.joinColumns?.[0]?.databaseName || 'baseId';

            return {
                entityMetadata: translationMetadata,
                actualEntityName: translationMetadata.name,
                resolvedColumnName: translationColumn.databaseName,
                isTranslationEntity: true,
                ownerRelationColumnName: ownerColumnName,
            };
        }

        throw new UserInputError(`error.entity-has-no-field`, {
            entityName,
            fieldName,
        });
    }

    private async fieldValueExists(
        _ctx: RequestContext,
        repository: Repository<ObjectLiteral>,
        resolvedColumnName: string,
        value: string,
        exclusionConfig?: { columnName: string; value: string | number },
    ): Promise<boolean> {
        const qb = repository
            .createQueryBuilder('entity')
            .where(`entity.${resolvedColumnName} = :value`, { value });

        if (exclusionConfig) {
            qb.andWhere(`entity.${exclusionConfig.columnName} != :excludeValue`, {
                excludeValue: exclusionConfig.value,
            });
        }

        const count = await qb.getCount();
        return count > 0;
    }
}
