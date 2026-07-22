/**
 * Internal discriminator for how Vendure uses and manages an Asset.
 *
 * This classification does not control access to the underlying storage URL.
 */
export enum AssetUsage {
    LIBRARY = 'LIBRARY',
    SYSTEM = 'SYSTEM',
}
