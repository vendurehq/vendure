import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, getMetadataArgsStorage, ManyToOne, OneToMany, Unique } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { Translation } from '../common/types/locale-types';

import { VendureEntity } from './base/base.entity';
import { coreEntitiesMap } from './entities';
import { registerTranslationEntityUniqueConstraints } from './register-translation-unique-constraints';

@Entity()
class TestArticle extends VendureEntity {
    constructor(input?: DeepPartial<TestArticle>) {
        super(input);
    }

    @OneToMany(() => TestArticleTranslation, translation => translation.base)
    translations: Array<Translation<TestArticle>>;
}

@Entity()
class TestArticleTranslation extends VendureEntity implements Translation<TestArticle> {
    constructor(input?: DeepPartial<Translation<TestArticle>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @Column() name: string;

    @ManyToOne(() => TestArticle, base => base.translations)
    base: TestArticle;
}

@Entity()
class TestArticleTranslationSubclass extends TestArticleTranslation {}

@Entity()
class TestSubclassArticle extends VendureEntity {
    @OneToMany(() => TestArticleTranslationSubclass, translation => translation.base)
    translations: Array<Translation<TestArticle>>;
}

// Declares the `translations` relation by entity name, as plugins do to break circular imports.
@Entity()
class TestStringTargetArticle extends VendureEntity {
    constructor(input?: DeepPartial<TestStringTargetArticle>) {
        super(input);
    }

    @OneToMany('TestStringTargetArticleTranslation', 'base')
    translations: Array<Translation<TestStringTargetArticle>>;
}

@Entity()
class TestStringTargetArticleTranslation extends VendureEntity {
    constructor(input?: DeepPartial<TestStringTargetArticleTranslation>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @ManyToOne('TestStringTargetArticle', 'translations')
    base: TestStringTargetArticle;
}

// Has the `languageCode` and `base` members of `Translation<T>`, but nothing points a
// `translations` relation at it, so it is not a translation entity.
@Entity()
class TestArticleRevision extends VendureEntity {
    constructor(input?: DeepPartial<TestArticleRevision>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @ManyToOne(() => TestArticle)
    base: TestArticle;
}

@Entity()
class TestPreConstrainedArticle extends VendureEntity {
    @OneToMany(() => TestPreConstrainedTranslation, translation => translation.base)
    translations: Array<Translation<TestArticle>>;
}

@Entity()
@Unique(['languageCode', 'base'])
class TestPreConstrainedTranslation extends VendureEntity implements Translation<TestArticle> {
    constructor(input?: DeepPartial<Translation<TestArticle>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @ManyToOne(() => TestArticle)
    base: TestArticle;
}

const testEntities = [
    TestArticle,
    TestArticleTranslation,
    TestArticleTranslationSubclass,
    TestPreConstrainedTranslation,
    TestStringTargetArticleTranslation,
    TestArticleRevision,
];

function uniquesFor(target: new (...args: any[]) => any) {
    return getMetadataArgsStorage().uniques.filter(unique => unique.target === target);
}

function removeTestUniques() {
    const metadata = getMetadataArgsStorage();
    // @ts-ignore - accessing protected properties for test cleanup
    metadata.uniques = metadata.uniques.filter(
        unique =>
            !testEntities.includes(unique.target as any) || unique.target === TestPreConstrainedTranslation,
    );
}

describe('registerTranslationEntityUniqueConstraints()', () => {
    afterEach(() => {
        removeTestUniques();
    });

    it('adds a (languageCode, base) unique constraint to translation entities', () => {
        registerTranslationEntityUniqueConstraints([TestArticle, TestArticleTranslation]);

        const uniques = uniquesFor(TestArticleTranslation);
        expect(uniques).toHaveLength(1);
        expect(uniques[0].columns).toEqual(['languageCode', 'base']);
    });

    it('does not add a constraint to non-translation entities', () => {
        registerTranslationEntityUniqueConstraints([TestArticle, TestArticleTranslation]);

        expect(uniquesFor(TestArticle)).toHaveLength(0);
    });

    // #5327: the constraint uses the same relation-based definition as custom-field registration
    it('does not add a constraint to an entity that no translations relation targets', () => {
        registerTranslationEntityUniqueConstraints([TestArticle, TestArticleRevision]);

        expect(uniquesFor(TestArticleRevision)).toHaveLength(0);
    });

    it('detects a translation entity targeted by a string-named translations relation', () => {
        registerTranslationEntityUniqueConstraints([
            TestStringTargetArticle,
            TestStringTargetArticleTranslation,
        ]);

        const uniques = uniquesFor(TestStringTargetArticleTranslation);
        expect(uniques).toHaveLength(1);
        expect(uniques[0].columns).toEqual(['languageCode', 'base']);
    });

    it('is idempotent across repeated bootstraps in the same process', () => {
        registerTranslationEntityUniqueConstraints([TestArticleTranslation]);
        registerTranslationEntityUniqueConstraints([TestArticleTranslation]);

        expect(uniquesFor(TestArticleTranslation)).toHaveLength(1);
    });

    it('detects languageCode and base declared on a parent class', () => {
        registerTranslationEntityUniqueConstraints([TestArticleTranslationSubclass]);

        const uniques = uniquesFor(TestArticleTranslationSubclass);
        expect(uniques).toHaveLength(1);
        expect(uniques[0].columns).toEqual(['languageCode', 'base']);
    });

    it('leaves an entity with its own @Unique([languageCode, base]) untouched', () => {
        registerTranslationEntityUniqueConstraints([TestPreConstrainedTranslation]);

        expect(uniquesFor(TestPreConstrainedTranslation)).toHaveLength(1);
    });

    it('constrains every core translation entity', () => {
        const coreEntities = Object.values(coreEntitiesMap) as Array<new () => any>;
        const coreTranslationEntities = coreEntities.filter(entity => entity.name.endsWith('Translation'));
        expect(coreTranslationEntities.length).toBeGreaterThanOrEqual(13);

        registerTranslationEntityUniqueConstraints(coreEntities);
        try {
            for (const entity of coreTranslationEntities) {
                expect(uniquesFor(entity), entity.name).toHaveLength(1);
            }
        } finally {
            const metadata = getMetadataArgsStorage();
            // @ts-ignore - accessing protected properties for test cleanup
            metadata.uniques = metadata.uniques.filter(
                unique => !coreTranslationEntities.includes(unique.target as any),
            );
        }
    });
});
