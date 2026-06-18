import { MetadataArgsStorage } from 'typeorm/metadata-args/MetadataArgsStorage';

/**
 * @description
 * A function which allows TypeORM entity metadata to be manipulated prior to the DB schema being generated
 * during bootstrap.
 *
 * :::caution
 * Certain DB schema modifications will result in auto-generated migrations which will lead to data loss. For instance,
 * changing the data type of a column will drop the column & data and then re-create it. To avoid loss of important data,
 * always check and modify your migration scripts as needed.
 * :::
 *
 * @example
 * ```ts
 * import { Index } from 'typeorm';
 * import { EntityMetadataModifier, ProductVariant } from '\@vendure/core';
 *
 * // Adds a unique index to the ProductVariant.sku column
 * export const addSkuUniqueIndex: EntityMetadataModifier = metadata => {
 *   const instance = new ProductVariant();
 *   Index({ unique: true })(instance, 'sku');
 * };
 * ```
 *
 * @example
 * ```ts
 * import { Column } from 'typeorm';
 * import { EntityMetadataModifier, ProductTranslation } from '\@vendure/core';
 *
 * // Use the "mediumtext" datatype for the Product's description rather than
 * // the default "text" type.
 * export const makeProductDescriptionMediumText: EntityMetadataModifier = metadata => {
 *     const descriptionColumnIndex = metadata.columns.findIndex(
 *         col => col.propertyName === 'description' && col.target === ProductTranslation,
 *     );
 *     if (-1 < descriptionColumnIndex) {
 *         // First we need to remove the existing column definition
 *         // from the metadata.
 *         metadata.columns.splice(descriptionColumnIndex, 1);
 *         // Then we add a new column definition with our custom
 *         // data type "mediumtext"
 *         // DANGER: this particular modification will generate a DB migration
 *         // which will result in data loss of existing descriptions. Make sure
 *         // to manually check & modify your migration scripts.
 *         const instance = new ProductTranslation();
 *         Column({ type: 'mediumtext' })(instance, 'description');
 *     }
 * };
 * ```
 *
 * @docsCategory configuration
 * @docsPage EntityOptions
 * @since 1.6.0
 */
export type EntityMetadataModifier = (metadata: MetadataArgsStorage) => void | Promise<void>;
