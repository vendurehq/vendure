import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomApiKeyFieldsTranslation } from '../custom-entity-fields';

import { ApiKey } from './api-key.entity';

@Entity()
export class ApiKeyTranslation extends VendureEntity implements Translation<ApiKey>, HasCustomFields {
    constructor(input?: DeepPartial<Translation<ApiKey>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @Index()
    @ManyToOne(type => ApiKey, base => base.translations, { onDelete: 'CASCADE' })
    base: ApiKey;

    @Column(type => CustomApiKeyFieldsTranslation)
    customFields: CustomApiKeyFieldsTranslation;

    @Column()
    name: string;
}
