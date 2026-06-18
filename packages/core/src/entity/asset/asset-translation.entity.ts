import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomAssetFieldsTranslation } from '../custom-entity-fields';

import { Asset } from './asset.entity';

@Entity()
export class AssetTranslation extends VendureEntity implements Translation<Asset>, HasCustomFields {
    constructor(input?: DeepPartial<Translation<Asset>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @Column() name: string;

    @Index()
    @ManyToOne(type => Asset, base => base.translations, { onDelete: 'CASCADE' })
    base: Asset;

    @Column(type => CustomAssetFieldsTranslation)
    customFields: CustomAssetFieldsTranslation;
}
