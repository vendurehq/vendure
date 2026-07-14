import { LanguageCode } from '@vendure/common/lib/generated-types';
import { CustomFieldsObject, ID } from '@vendure/common/lib/shared-types';

import { VendureEntity } from '../../entity/base/base.entity';
import { TranslatableRelationsKeys } from '../../service/helpers/utils/translate-entity';

import { UnwrappedArray } from './common-types';

/**
 * This type should be used in any interfaces where the value is to be
 * localized into different languages.
 */
export type LocaleString = string & { _opaqueType: 'LocaleString' };

export type TranslatableKeys<T, U = Omit<T, 'translations'>> = {
    [K in keyof U]: U[K] extends LocaleString ? K : never;
}[keyof U];

export type NonTranslateableKeys<T> = { [K in keyof T]: T[K] extends LocaleString ? never : K }[keyof T];

// prettier-ignore
/**
 * @description
 * Entities which have localizable string properties should implement this type.
 *
 * @docsCategory entities
 * @docsPage interfaces
 */
export interface Translatable {
    translations: Array<Translation<VendureEntity>>;
}

export type TranslationCustomFields<T> = { [K in keyof T]: K extends 'customFields' ? K : never }[keyof T];

// prettier-ignore
/**
 * Translations of localizable entities should implement this type.
 */
export type Translation<T> =
// Translation must include the languageCode and a reference to the base Translatable entity it is associated with
    {
        id: ID;
        createdAt: Date;
        updatedAt: Date;
        languageCode: LanguageCode;
        base: T;
    } &
    // Translation must include all translatable keys as a string type
    { [K in TranslatableKeys<T>]: string; } &
    { [K in TranslationCustomFields<T>]: CustomFieldsObject; };

/**
 * This is the type of a translation object when provided as input to a create or update operation.
 */
export type TranslationInput<T> = { [K in TranslatableKeys<T>]?: string | null } & {
    id?: ID | null;
    languageCode: LanguageCode | `${LanguageCode}`;
};

/**
 * This interface defines the shape of a DTO used to create / update an entity which has one or more LocaleString
 * properties.
 */
export interface TranslatedInput<T> {
    translations?: Array<TranslationInput<T>> | null;
}

// prettier-ignore
/**
 * This is the type of a Translatable entity after it has been deep-translated into a given language.
 */
export type Translated<T> = T & { languageCode: LanguageCode; } & {
    [K in TranslatableRelationsKeys<T>]: T[K] extends any[] ? Array<Translated<UnwrappedArray<T[K]>>> : Translated<T[K]>;
};
