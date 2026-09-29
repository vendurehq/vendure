import { DeepPartial, ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError } from '../../../common/error/errors';
import { Translatable, Translation, TranslationInput } from '../../../common/types/locale-types';
import { foundIn, not } from '../../../common/utils';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { isUniqueConstraintViolationError } from '../utils/db-errors';

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
                    // Run the insert in a savepoint (nested transaction). On Postgres, a unique
                    // constraint violation aborts the entire enclosing transaction, which would
                    // otherwise make the fallback queries below fail with "current transaction is
                    // aborted" instead of recovering. Rolling back just the savepoint keeps the
                    // outer transaction (shared with the rest of this request) healthy.
                    newTranslation = await this.connection.withTransaction(ctx, transactionCtx =>
                        this.connection
                            .getRepository(transactionCtx, this.translationCtor)
                            .save(translation as any),
                    );
                } catch (err: any) {
                    if (!isUniqueConstraintViolationError(err)) {
                        throw new InternalServerError(err.message);
                    }
                    // A concurrent request inserted a translation for this languageCode between
                    // our initial read and this insert, and has already committed — our insert
                    // blocked on its row lock until it did. Adopt that committed row rather than
                    // failing the request.
                    //
                    // The lookup must use the raw connection: under REPEATABLE READ (the
                    // MySQL/MariaDB default) this request's transaction snapshot predates the
                    // concurrent commit, so a read inside the transaction cannot see the row.
                    // Writing our own content to that row from inside the transaction is not an
                    // option either, because MariaDB (with its default snapshot isolation)
                    // rejects any write to a row that changed after the snapshot was taken
                    // ("Record has changed since last read"). So the losing request converges on
                    // the winner's row instead of overwriting it. For the practical trigger of
                    // this race — the same update submitted twice, e.g. a double-clicked save
                    // button — the two payloads are identical, so the outcome is the same either
                    // way.
                    const concurrentlyInserted = await this.connection.rawConnection
                        .getRepository(this.translationCtor)
                        .findOne({
                            where: {
                                base: { id: entity.id },
                                languageCode: translation.languageCode,
                            },
                        } as any);
                    if (!concurrentlyInserted) {
                        throw new InternalServerError(err.message);
                    }
                    newTranslation = concurrentlyInserted;
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
