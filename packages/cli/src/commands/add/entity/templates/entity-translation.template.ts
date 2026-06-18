import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { HasCustomFields, Translation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { ScaffoldEntity } from './entity.template';

export class ScaffoldEntityCustomFieldsTranslation {}

@Entity()
export class ScaffoldTranslation
    extends VendureEntity
    implements Translation<ScaffoldEntity>, HasCustomFields
{
    constructor(input?: DeepPartial<Translation<ScaffoldTranslation>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @Column() localizedName: string;

    @Index()
    @ManyToOne(type => ScaffoldEntity, base => base.translations, { onDelete: 'CASCADE' })
    base: ScaffoldEntity;

    @Column(type => ScaffoldEntityCustomFieldsTranslation)
    customFields: ScaffoldEntityCustomFieldsTranslation;
}
