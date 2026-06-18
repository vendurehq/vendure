import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity } from 'typeorm';

import { VendureEntity } from '../../entity/base/base.entity';
import { JobConfig } from '../../job-queue/types';

@Entity()
export class JobRecordBuffer extends VendureEntity {
    constructor(input: DeepPartial<JobRecordBuffer>) {
        super(input);
    }

    @Column()
    bufferId: string;

    @Column('simple-json')
    job: JobConfig<any>;
}
