import {
    CreateCollectionInput,
    CreateCollectionTranslationInput,
    LanguageCode,
    Permission,
} from '@vendure/common/lib/generated-types';

import { Injector } from '../../../common/injector';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Collection } from '../../../entity/collection/collection.entity';
import { CollectionService } from '../../../service/services/collection.service';
import { EntityDuplicator } from '../entity-duplicator';

let connection: TransactionalConnection;
let collectionService: CollectionService;

/**
 * @description
 * Duplicates a Collection
 */
export const collectionDuplicator = new EntityDuplicator({
    code: 'collection-duplicator',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Default duplicator for Collections',
        },
    ],
    requiresPermission: [Permission.CreateCollection, Permission.CreateCatalog],
    forEntities: ['Collection'],
    args: {},
    init(injector: Injector) {
        connection = injector.get(TransactionalConnection);
        collectionService = injector.get(CollectionService);
    },
    async duplicate({ ctx, id }) {
        const collection = await connection.getEntityOrThrow(ctx, Collection, id, {
            relations: {
                featuredAsset: true,
                assets: true,
                channels: true,
            },
        });
        const translations: CreateCollectionTranslationInput[] = collection.translations.map(translation => {
            return {
                name: translation.name + ' (copy)',
                slug: translation.slug + '-copy',
                description: translation.description,
                languageCode: translation.languageCode,
                customFields: translation.customFields,
            };
        });
        const collectionInput: CreateCollectionInput = {
            featuredAssetId: collection.featuredAsset?.id,
            isPrivate: true,
            assetIds: collection.assets.map(value => value.assetId),
            parentId: collection.parentId,
            translations,
            customFields: collection.customFields,
            filters: collection.filters.map(filter => ({
                code: filter.code,
                arguments: filter.args,
            })),
        };

        const duplicatedCollection = await collectionService.create(ctx, collectionInput);
        return duplicatedCollection;
    },
});
