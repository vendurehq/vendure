import { Column, Entity, Unique } from 'typeorm';

import { VendureEntity } from '../../entity/base/base.entity';

@Entity()
@Unique(['taskId'])
export class ScheduledTaskRecord extends VendureEntity {
    constructor(input: Partial<ScheduledTaskRecord>) {
        super(input);
    }

    @Column()
    taskId: string;

    @Column({ default: true })
    enabled: boolean;

    @Column({ type: Date, nullable: true, precision: 3 })
    lockedAt: Date | null;

    @Column({ type: Date, nullable: true, precision: 3 })
    lastExecutedAt: Date | null;

    @Column({ type: Date, nullable: true, precision: 3 })
    manuallyTriggeredAt: Date | null;

    @Column({ type: 'json', nullable: true })
    lastResult: Record<string, any> | string | number | null;
}
