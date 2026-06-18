import { DeepPartial, ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError } from '../../../common/error/errors';
import { Translatable, Translation, TranslationInput } from '../../../common/types/locale-types';
import { foundIn, not } from '../../../common/utils';
import { TransactionalConnection } from '../../../connection/transactional-connection';

export type TranslationContructor<T> = new (
    input?: DeepPartial<TranslationInput<T>> | DeepPartial<Translation<T>>,
) => Translation<T>;

export interface TranslationDiff<T> {
    toUpdate: Array<Translation<T>>;
    toAdd: Array<Translation<T>>;
}

/**
 * This class is to be used when performing an update on a Translatable entity.
 */
export class TranslationDiffer<Entity extends Translatable & { id: ID }> {
    constructor(
        private translationCtor: TranslationContructor<Entity>,
        private connection: TransactionalConnection,
    ) {}

    /**
     * Compares the existing translations with the updated translations and produces a diff of
     * added, removed and updated translations.
     */
    diff(
        existing: Array<Translation<Entity>>,
        updated?: Array<TranslationInput<Entity>> | null,
    ): TranslationDiff<Entity> {
        if (updated) {
            const translationEntities = this.translationInputsToEntities(updated, existing);
            const toAdd = translationEntities.filter(not(foundIn(existing, 'languageCode')));
            const toUpdate = translationEntities.filter(foundIn(existing, 'languageCode'));

            return { toUpdate, toAdd };
        } else {
            return {
                toUpdate: [],
                toAdd: [],
            };
        }
    }

    async applyDiff(
        ctx: RequestContext,
        entity: Entity,
        { toUpdate, toAdd }: TranslationDiff<Entity>,
    ): Promise<Entity> {
        if (toUpdate.length) {
            for (const translation of toUpdate) {
                // any cast below is required due to TS issue: https://github.com/Microsoft/TypeScript/issues/21592
                const updated = await this.connection
                    .getRepository(ctx, this.translationCtor)
                    .save(translation as any);
                const index = entity.translations.findIndex(t => t.languageCode === updated.languageCode);
                entity.translations.splice(index, 1, updated);
            }
        }

        if (toAdd.length) {
            for (const translation of toAdd) {
                translation.base = entity;
                (translation as any).baseId = entity.id;
                let newTranslation: any;
                try {
                    newTranslation = await this.connection
                        .getRepository(ctx, this.translationCtor)
                        .save(translation as any);
                } catch (err: any) {
                    throw new InternalServerError(err.message);
                }
                entity.translations.push(newTranslation);
            }
        }

        return entity;
    }

    private translationInputsToEntities(
        inputs: Array<TranslationInput<Entity>>,
        existing: Array<Translation<Entity>>,
    ): Array<Translation<Entity>> {
        return inputs.map(input => {
            const counterpart = existing.find(e => e.languageCode === input.languageCode);
            // any cast below is required due to TS issue: https://github.com/Microsoft/TypeScript/issues/21592
            const entity = new this.translationCtor(input as any);
            if (counterpart) {
                entity.id = counterpart.id;
                entity.base = counterpart.base;
            }
            return entity;
        });
    }
}
