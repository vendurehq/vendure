import { Type } from '@vendure/common/lib/shared-types';

interface IdColumnOptions {
    /** Whether the field is nullable. Defaults to false */
    nullable?: boolean;
    /** Whether this is a primary key. Defaults to false */
    primary?: boolean;
}

interface IdColumnConfig {
    name: string;
    entity: any;
    options?: IdColumnOptions;
}

const idColumnRegistry = new Map<any, IdColumnConfig[]>();
let primaryGeneratedColumn: { entity: any; name: string } | undefined;

/**
 * Decorates a property which should be marked as a generated primary key.
 * Designed to be applied to the VendureEntity id property.
 */
export function PrimaryGeneratedId() {
    return (entity: any, propertyName: string) => {
        primaryGeneratedColumn = {
            entity,
            name: propertyName,
        };
    };
}

/**
 * @description
 * Decorates a property which points to another entity by ID. This custom decorator is needed
 * because we do not know the data type of the ID column until runtime, when we have access
 * to the configured EntityIdStrategy.
 *
 * @docsCategory configuration
 * @docsPage EntityId Decorator
 */
export function EntityId(options?: IdColumnOptions) {
    return (entity: any, propertyName: string) => {
        const idColumns = idColumnRegistry.get(entity);
        const entry = { name: propertyName, entity, options };
        if (idColumns) {
            idColumns.push(entry);
        } else {
            idColumnRegistry.set(entity, [entry]);
        }
    };
}

/**
 * Returns any columns on the entity which have been decorated with the {@link EntityId}
 * decorator.
 *
 * Multiple registry entries can exist for a single entity type, since dynamically-registered
 * columns (e.g. custom field relation id columns) are decorated on separate instances
 * rather than on the class prototype.
 */
export function getIdColumnsFor(entityType: Type<any>): IdColumnConfig[] {
    return Array.from(idColumnRegistry.entries())
        .filter(([entity]) => entity.constructor === entityType)
        .flatMap(([, columns]) => columns);
}

/**
 * Returns the entity and property name that was decorated with the {@link PrimaryGeneratedId}
 * decorator.
 */
export function getPrimaryGeneratedIdColumn(): { entity: any; name: string } {
    if (!primaryGeneratedColumn) {
        throw new Error(
            'primaryGeneratedColumn is undefined. The base VendureEntity must have the @PrimaryGeneratedId() decorator set on its id property.',
        );
    }
    return primaryGeneratedColumn;
}
