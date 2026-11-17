import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { CreateDateColumn, UpdateDateColumn } from 'typeorm';

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
                if (
                    key === 'customFields' &&
                    descriptor.value != null &&
                    typeof descriptor.value === 'object'
                ) {
                    // Clone the customFields object rather than sharing the input's reference.
                    // On save, TypeORM mutates the entity's embedded customFields object
                    // (e.g. setting all absent nullable columns to null), and via a shared
                    // reference those mutations would corrupt the input object, making
                    // absent custom fields indistinguishable from explicit nulls.
                    (this as any)[key] = { ...descriptor.value };
                } else {
                    (this as any)[key] = descriptor.value;
                }
            }
        }
    }

    @PrimaryGeneratedId()
    id: ID;

    @CreateDateColumn() createdAt: Date;

    @UpdateDateColumn() updatedAt: Date;
}
