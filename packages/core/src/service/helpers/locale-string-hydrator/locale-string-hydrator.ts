import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { FindOneOptions } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { Translatable, TranslatableKeys, Translated } from '../../../common/types/locale-types';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { VendureEntity } from '../../../entity/base/base.entity';
import { TranslatorService } from '../translator/translator.service';

/**
 * This helper class is to be used in GraphQL entity resolvers, to resolve fields which depend on being
 * translated (i.e. the corresponding entity field is of type `LocaleString`).
 */
@Injectable()
export class LocaleStringHydrator {
    constructor(
        private connection: TransactionalConnection,
        private requestCache: RequestContextCacheService,
        private translator: TranslatorService,
    ) {}

    async hydrateLocaleStringField<T extends VendureEntity & Translatable & { languageCode?: LanguageCode }>(
        ctx: RequestContext,
        entity: T,
        fieldName: TranslatableKeys<T> | 'languageCode',
    ): Promise<string> {
        if (entity[fieldName]) {
            // Already hydrated, so return the value
            return entity[fieldName] as any;
        }
        await this.hydrateLocaleStrings(ctx, entity);
        return entity[fieldName] as any;
    }

    /**
     * Takes a translatable entity and populates all the LocaleString fields
     * by fetching the translations from the database (they will be eagerly loaded).
     *
     * This method includes a caching optimization to prevent multiple DB calls when many
     * translatable fields are needed on the same entity in a resolver.
     */
    private async hydrateLocaleStrings<T extends VendureEntity & Translatable>(
        ctx: RequestContext,
        entity: T,
    ): Promise<Translated<T>> {
        const entityType = entity.constructor.name;
        if (!entity.translations?.length) {
            const cacheKey = `hydrate-${entityType}-${entity.id}`;
            let dbCallPromise = this.requestCache.get<Promise<T | null>>(ctx, cacheKey);

            if (!dbCallPromise) {
                dbCallPromise = this.connection
                    .getRepository<T>(ctx, entityType)
                    .findOne({ where: { id: entity.id } } as FindOneOptions<T>);
                this.requestCache.set(ctx, cacheKey, dbCallPromise);
            }

            await dbCallPromise.then(withTranslations => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                entity.translations = withTranslations!.translations;
            });
        }
        if (entity.translations.length) {
            const translated = this.translator.translate(entity, ctx);
            for (const localeStringProp of Object.keys(entity.translations[0])) {
                if (
                    localeStringProp === 'base' ||
                    localeStringProp === 'id' ||
                    localeStringProp === 'createdAt' ||
                    localeStringProp === 'updatedAt'
                ) {
                    continue;
                }
                if (localeStringProp === 'customFields') {
                    (entity as any)[localeStringProp] = Object.assign(
                        (entity as any)[localeStringProp] ?? {},
                        (translated as any)[localeStringProp] ?? {},
                    );
                } else {
                    (entity as any)[localeStringProp] = (translated as any)[localeStringProp];
                }
            }
        }
        return entity as Translated<T>;
    }
}
