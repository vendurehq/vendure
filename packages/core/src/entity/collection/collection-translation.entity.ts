import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomCollectionFieldsTranslation } from '../custom-entity-fields';

import { Collection } from './collection.entity';

@Entity()
export class CollectionTranslation extends VendureEntity implements Translation<Collection>, HasCustomFields {
    constructor(input?: DeepPartial<Translation<Collection>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @Column() name: string;

    @Index({ unique: false })
    @Column()
    slug: string;

    @Column('text') description: string;

    @Index()
    @ManyToOne(type => Collection, base => base.translations, { onDelete: 'CASCADE' })
    base: Collection;

    @Column(type => CustomCollectionFieldsTranslation)
    customFields: CustomCollectionFieldsTranslation;
}
