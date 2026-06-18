import { Injectable } from '@nestjs/common';
import { DeletionResponse, DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { CustomFieldsObject, ID, PaginatedList } from '@vendure/common/lib/shared-types';
import {
    assertFound,
    CustomFieldRelationService,
    HasCustomFields,
    ListQueryBuilder,
    ListQueryOptions,
    RelationPaths,
    RequestContext,
    TransactionalConnection,
    Translatable,
    TranslatableSaver,
    Translated,
    Translation,
    TranslationInput,
    TranslatorService,
    VendureEntity,
    patchEntity,
} from '@vendure/core';

// These can be replaced by generated types if you set up code generation
interface CreateEntityInput {
    // Define the input fields here
    customFields?: CustomFieldsObject;
    translations: Array<TranslationInput<TemplateEntity>>;
}
interface UpdateEntityInput {
    id: ID;
    // Define the input fields here
    customFields?: CustomFieldsObject;
    translations: Array<TranslationInput<TemplateEntity>>;
}

class TemplateEntity extends VendureEntity implements Translatable, HasCustomFields {
    constructor() {
        super();
    }

    customFields: CustomFieldsObject;

    translations: Array<Translation<TemplateEntity>>;
}

class TemplateEntityTranslation extends VendureEntity implements Translation<TemplateEntity> {
    constructor() {
        super();
    }

    id: ID;
    languageCode: LanguageCode;
    base: TemplateEntity;
    customFields: CustomFieldsObject;
}

@Injectable()
export class EntityServiceTemplate {
    constructor(
        private connection: TransactionalConnection,
        private translatableSaver: TranslatableSaver,
        private listQueryBuilder: ListQueryBuilder,
        private customFieldRelationService: CustomFieldRelationService,
        private translator: TranslatorService,
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<TemplateEntity>,
        relations?: RelationPaths<TemplateEntity>,
    ): Promise<PaginatedList<Translated<TemplateEntity>>> {
        return this.listQueryBuilder
            .build(TemplateEntity, options, {
                relations,
                ctx,
            })
            .getManyAndCount()
            .then(([_items, totalItems]) => {
                const items = _items.map(item => this.translator.translate(item, ctx));
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(
        ctx: RequestContext,
        id: ID,
        relations?: RelationPaths<TemplateEntity>,
    ): Promise<Translated<TemplateEntity> | null> {
        return this.connection
            .getRepository(ctx, TemplateEntity)
            .findOne({
                where: { id },
                relations,
            })
            .then(entity => entity && this.translator.translate(entity, ctx));
    }

    async create(ctx: RequestContext, input: CreateEntityInput): Promise<Translated<TemplateEntity>> {
        const newEntity = await this.translatableSaver.create({
            ctx,
            input,
            entityType: TemplateEntity,
            translationType: TemplateEntityTranslation,
            beforeSave: async f => {
                // Any pre-save logic can go here
            },
        });
        // Ensure any custom field relations get saved
        await this.customFieldRelationService.updateRelations(ctx, TemplateEntity, input, newEntity);
        return assertFound(this.findOne(ctx, newEntity.id));
    }

    async update(ctx: RequestContext, input: UpdateEntityInput): Promise<Translated<TemplateEntity>> {
        const updatedEntity = await this.translatableSaver.update({
            ctx,
            input,
            entityType: TemplateEntity,
            translationType: TemplateEntityTranslation,
            beforeSave: async f => {
                // Any pre-save logic can go here
            },
        });
        // This is just here to stop the import being removed by the IDE
        patchEntity(updatedEntity, {});
        await this.customFieldRelationService.updateRelations(ctx, TemplateEntity, input, updatedEntity);
        return assertFound(this.findOne(ctx, updatedEntity.id));
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const entity = await this.connection.getEntityOrThrow(ctx, TemplateEntity, id);
        try {
            await this.connection.getRepository(ctx, TemplateEntity).remove(entity);
            return {
                result: DeletionResult.DELETED,
            };
        } catch (e: any) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: e.toString(),
            };
        }
    }
}
