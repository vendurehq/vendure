import { EntitySubscriberInterface, EventSubscriber, InsertEvent } from 'typeorm';

import { CalculatedColumnDefinition, CALCULATED_PROPERTIES } from '../common/calculated-decorator';

interface EntityPrototype {
    [CALCULATED_PROPERTIES]: CalculatedColumnDefinition[];
}

/**
 * @docs Subscribes to events entities to handle calculated decorators
 *
 * @docsCategory data-access
 */
@EventSubscriber()
export class CalculatedPropertySubscriber implements EntitySubscriberInterface {
    afterLoad(event: any) {
        this.moveCalculatedGettersToInstance(event);
    }

    afterInsert(event: InsertEvent<any>): Promise<any> | void {
        this.moveCalculatedGettersToInstance(event.entity);
    }

    /**
     * For any entity properties decorated with @Calculated(), this subscriber transfers
     * the getter from the entity prototype to the entity instance, so that it can be
     * correctly enumerated and serialized in the API response.
     */
    private moveCalculatedGettersToInstance(entity: any) {
        if (entity) {
            const prototype: EntityPrototype = Object.getPrototypeOf(entity);
            if (prototype.hasOwnProperty(CALCULATED_PROPERTIES)) {
                for (const calculatedPropertyDef of prototype[CALCULATED_PROPERTIES]) {
                    const getterDescriptor = Object.getOwnPropertyDescriptor(
                        prototype,
                        calculatedPropertyDef.name,
                    );
                    // eslint-disable-next-line @typescript-eslint/unbound-method
                    const getFn = getterDescriptor && getterDescriptor.get;
                    if (getFn && !entity.hasOwnProperty(calculatedPropertyDef.name)) {
                        const boundGetFn = getFn.bind(entity);
                        Object.defineProperties(entity, {
                            [calculatedPropertyDef.name]: {
                                get: () => boundGetFn(),
                                enumerable: true,
                            },
                        });
                    }
                }
            }
        }
    }
}

/**
 * A map of the core TypeORM Subscribers.
 */
export const coreSubscribersMap = {
    CalculatedPropertySubscriber,
};
