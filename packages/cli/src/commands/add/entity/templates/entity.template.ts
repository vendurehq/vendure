import {
    DeepPartial,
    HasCustomFields,
    LocaleString,
    Translatable,
    Translation,
    VendureEntity,
} from '@vendure/core';
import { Column, Entity, OneToMany } from 'typeorm';

import { ScaffoldTranslation } from './entity-translation.template';

export class ScaffoldEntityCustomFields {}

@Entity()
export class ScaffoldEntity extends VendureEntity implements Translatable, HasCustomFields {
    constructor(input?: DeepPartial<ScaffoldEntity>) {
        super(input);
    }

    @Column()
    code: string;

    @Column(type => ScaffoldEntityCustomFields)
    customFields: ScaffoldEntityCustomFields;

    localizedName: LocaleString;

    @OneToMany(type => ScaffoldTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<ScaffoldEntity>>;
}
