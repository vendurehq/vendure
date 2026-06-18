import { LanguageCode } from '../generated-types';

export type Translation<T> = T & { languageCode: LanguageCode };
export type PossiblyTranslatable<T> = { translations?: Array<Translation<T>> | null };
export type TranslationOf<E> = E extends PossiblyTranslatable<infer U> ? U : undefined;

/**
 * @description
 * Given a translatable entity, returns the translation in the specified LanguageCode if
 * one exists.
 */
export function findTranslation<E extends PossiblyTranslatable<any>>(
    entity: E | undefined,
    languageCode: LanguageCode,
): TranslationOf<E> | undefined {
    return (entity?.translations || []).find(t => t.languageCode === languageCode);
}
