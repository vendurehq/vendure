import { FindOperator } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { ApplyValueTransformers } from 'typeorm/util/ApplyValueTransformers';

let patchApplied = false;

/**
 * Works around a TypeORM bug which breaks columns that are simultaneously a regular column
 * and the join column of a relation ("relation id columns"), when they are defined inside an
 * embedded entity. This is the case for the id columns of relation custom fields, e.g.
 * `customFields.ownerId` alongside the `customFields.owner` relation.
 *
 * In `ColumnMetadata.getEntityValue()`, the embedded-column branch calls
 * `this.relationMetadata.getEntityValue(embeddedObject)`, passing the already-extracted
 * embedded object. However, `RelationMetadata.getEntityValue()` expects the full entity and
 * performs the embedded-path traversal itself, so the relation value always resolves to
 * `undefined`. The consequence is that a relation object assigned to e.g.
 * `entity.customFields.owner` is ignored when TypeORM computes the value of the join column,
 * and the assignment is silently not persisted.
 *
 * Reported upstream as https://github.com/typeorm/typeorm/issues/12725, with a fix submitted
 * in https://github.com/typeorm/typeorm/pull/12726. This workaround can be removed once the
 * minimum supported TypeORM version contains that fix.
 *
 * The override below only takes effect for columns which are both embedded and merged with a
 * relation join column. All other columns are handled by the original implementation.
 */
export function patchTypeOrmEmbeddedRelationColumns() {
    if (patchApplied) {
        return;
    }
    patchApplied = true;

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGetEntityValue = ColumnMetadata.prototype.getEntityValue;
    ColumnMetadata.prototype.getEntityValue = function (
        this: ColumnMetadata,
        entity: any,
        transform = false,
    ) {
        if (entity != null && this.embeddedMetadata && this.relationMetadata && this.referencedColumn) {
            const relatedEntity = this.relationMetadata.getEntityValue(entity);
            if (relatedEntity !== undefined && !isSpecialObject(relatedEntity)) {
                let value: any;
                if (relatedEntity !== null && typeof relatedEntity === 'object') {
                    value = this.referencedColumn.getEntityValue(relatedEntity);
                } else {
                    // `null` (which clears the relation) or a directly-assigned id value
                    value = relatedEntity;
                }
                if (transform && this.transformer) {
                    value = ApplyValueTransformers.transformTo(this.transformer, value);
                }
                return value;
            }
            // If the relation property is not set on the entity, fall through to the original
            // implementation, which will use the value of the id column property itself.
        }
        return originalGetEntityValue.call(this, entity, transform);
    };
}

function isSpecialObject(value: any): boolean {
    return (
        value instanceof FindOperator ||
        typeof value === 'function' ||
        Buffer.isBuffer(value) ||
        value instanceof Date
    );
}
