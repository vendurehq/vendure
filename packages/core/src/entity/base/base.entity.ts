import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { PrimaryGeneratedId } from '../entity-id.decorator';

/**
 * @description
 * This is the base class from which all entities inherit. The type of
 * the `id` property is defined by the {@link EntityIdStrategy}.
 *
 * @docsCategory entities
 */
export abstract class VendureEntity {
    protected constructor(input?: DeepPartial<VendureEntity>) {
        if (input) {
            for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
                if (descriptor.get && !descriptor.set) {
                    // A getter has been moved to the entity instance
                    // by the CalculatedPropertySubscriber
                    // and cannot be copied over to the new instance.
                    continue;
                }
                (this as any)[key] = descriptor.value;
            }
        }
    }

    @PrimaryGeneratedId()
    id: ID;

    @CreateDateColumn() createdAt: Date;

    @UpdateDateColumn() updatedAt: Date;
}
