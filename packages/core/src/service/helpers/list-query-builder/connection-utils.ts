import { Type } from '@vendure/common/lib/shared-types';
import { DataSource } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

import { Translation } from '../../../common/types/locale-types';
import { VendureEntity } from '../../../entity/base/base.entity';

/**
 * @description
 * Returns TypeORM ColumnMetadata for the given entity type.
 */
export function getColumnMetadata<T>(connection: DataSource, entity: Type<T>) {
    const metadata = connection.getMetadata(entity);
    const columns = metadata.columns;
    let translationColumns: ColumnMetadata[] = [];
    const relations = metadata.relations;

    const translationRelation = relations.find(r => r.propertyName === 'translations');
    if (translationRelation) {
        const commonFields: Array<keyof (Translation<T> & VendureEntity)> = [
            'id',
            'createdAt',
            'updatedAt',
            'languageCode',
        ];
        const translationMetadata = connection.getMetadata(translationRelation.type);
        translationColumns = translationColumns.concat(
            translationMetadata.columns.filter(
                c => !c.relationMetadata && !commonFields.includes(c.propertyName as any),
            ),
        );
    }
    const alias = metadata.name.toLowerCase();
    return { columns, translationColumns, alias };
}

export function getEntityAlias<T>(connection: DataSource, entity: Type<T>): string {
    return connection.getMetadata(entity).name.toLowerCase();
}

/**
 * @description
 * Escapes identifiers in an expression according to the current database driver.
 */
export function escapeCalculatedColumnExpression(connection: DataSource, expression: string): string {
    return expression.replace(/\b([a-z]+[A-Z]\w+)\b/g, substring => connection.driver.escape(substring));
}
