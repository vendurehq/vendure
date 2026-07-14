import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Permission, SettingsStoreScopeType } from '@vendure/common/lib/generated-types';
import { JsonCompatible } from '@vendure/common/lib/shared-types';
import ms, { type StringValue } from 'ms';

import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError, UserInputError } from '../../../common/error/errors';
import { Injector } from '../../../common/injector';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import {
    CleanupOrphanedSettingsStoreEntriesOptions,
    CleanupOrphanedSettingsStoreEntriesResult,
    OrphanedSettingsStoreEntry,
    SetSettingsStoreValueResult,
    SettingsStoreFieldConfig,
    SettingsStoreRegistration,
    SettingsStoreScopes,
} from '../../../config/settings-store/settings-store-types';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { SettingsStoreEntry } from '../../../entity/settings-store-entry/settings-store-entry.entity';

/**
 * @description
 * The SettingsStoreService provides a flexible settings storage system with support for
 * scoping, permissions, and validation. It allows plugins and the core system to
 * store and retrieve configuration data with fine-grained control over access and isolation.
 *
 * ## Usage
 *
 * Values are automatically scoped according to their field configuration:
 *
 * @example
 * ```ts
 * // In a service
 * const userTheme = await this.settingsStoreService.get('dashboard.theme', ctx);
 * await this.settingsStoreService.set('dashboard.theme', 'dark', ctx);
 *
 * // Get multiple values
 * const settings = await this.settingsStoreService.getMany([
 *   'dashboard.theme',
 *   'dashboard.tableFilters'
 * ], ctx);
 * ```
 *
 * @docsCategory services
 * @since 3.4.0
 */
@Injectable()
export class SettingsStoreService implements OnModuleInit {
    private readonly fieldRegistry = new Map<string, SettingsStoreFieldConfig>();
    private readonly injector: Injector;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly moduleRef: ModuleRef,
        private readonly configService: ConfigService,
    ) {
        this.injector = new Injector(this.moduleRef);
    }

    onModuleInit() {
        this.initializeFieldRegistrations();
    }

    /**
     * @description
     * Initialize field registrations from the Vendure configuration.
     * Called during module initialization.
     */
    private initializeFieldRegistrations(): void {
        const settingsStoreFields = this.configService.settingsStoreFields || {};

        for (const [namespace, fields] of Object.entries(settingsStoreFields)) {
            this.register({ namespace, fields });
        }
    }

    /**
     * @description
     * Register settings store fields. This is typically called during application
     * bootstrap when processing the VendureConfig.
     */
    register(registration: SettingsStoreRegistration): void {
        for (const field of registration.fields) {
            const fullKey = `${registration.namespace}.${field.name}`;
            this.fieldRegistry.set(fullKey, field);
            Logger.debug(`Registered settings store field: ${fullKey}`);
        }
    }

    /**
     * @description
     * Get a value for the specified key. The value is automatically scoped
     * according to the field's scope configuration.
     *
     * @param key - The full key (namespace.field)
     * @param ctx - Request context for scoping and permissions
     * @returns The stored value or undefined if not found or access denied
     */
    async get<T = JsonCompatible<any>>(ctx: RequestContext, key: string): Promise<T | undefined>;
    /**
     * @deprecated Use the `ctx` arg in the first position
     */
    async get<T = JsonCompatible<any>>(key: string, ctx: RequestContext): Promise<T | undefined>;
    async get<T = JsonCompatible<any>>(
        keyOrCtx: string | RequestContext,
        ctxOrKey: RequestContext | string,
    ): Promise<T | undefined> {
        const { ctx, other: key } = this.determineCtx(keyOrCtx, ctxOrKey);
        const fieldConfig = this.getFieldConfig(key);
        const scope = this.generateScope(key, undefined, ctx, fieldConfig);

        const entry = await this.connection.getRepository(ctx, SettingsStoreEntry).findOne({
            where: { key, scope },
        });

        return entry?.value as T;
    }

    /**
     * @description
     * Get multiple values efficiently. Each key is scoped according to
     * its individual field configuration.
     *
     * @param keys - Array of full keys to retrieve
     * @param ctx - Request context for scoping and permissions
     * @returns Object mapping keys to their values
     */
    async getMany(ctx: RequestContext, keys: string[]): Promise<Record<string, JsonCompatible<any>>>;
    /**
     * @deprecated Use `ctx` as the first argument
     */
    async getMany(keys: string[], ctx: RequestContext): Promise<Record<string, JsonCompatible<any>>>;
    async getMany(
        keysOrCtx: string[] | RequestContext,
        ctxOrKeys: RequestContext | string[],
    ): Promise<Record<string, JsonCompatible<any>>> {
        const { ctx, other: keys } = this.determineCtx(keysOrCtx, ctxOrKeys);
        const result: Record<string, any> = {};

        // Build array of key/scopeKey pairs for authorized keys
        const queries: Array<{ key: string; scope: string }> = [];

        for (const key of keys) {
            const fieldConfig = this.getFieldConfig(key);
            const scope = this.generateScope(key, undefined, ctx, fieldConfig);
            queries.push({ key, scope });
        }

        if (queries.length === 0) {
            return result;
        }

        // Execute single query for all authorized keys using OR conditions
        const qb = this.connection.getRepository(ctx, SettingsStoreEntry).createQueryBuilder('entry');

        // Build OR conditions for each key/scope pair
        const orConditions = queries
            .map((q, index) => `(entry.key = :key${index} AND entry.scope = :scope${index})`)
            .join(' OR ');

        if (orConditions) {
            qb.where(orConditions);
            // Add parameters
            queries.forEach((q, index) => {
                qb.setParameter(`key${index}`, q.key);
                qb.setParameter(`scope${index}`, q.scope);
            });
        }

        const entries = await qb.getMany();

        // Map results back to keys
        for (const entry of entries) {
            result[entry.key] = entry.value;
        }

        return result;
    }

    /**
     * @description
     * Set a value for the specified key with structured result feedback.
     * This version returns detailed information about the success or failure
     * of the operation instead of throwing errors.
     *
     * @param key - The full key (namespace.field)
     * @param value - The value to store (must be JSON serializable)
     * @param ctx - Request context for scoping and permissions
     * @returns SetSettingsStoreValueResult with operation status and error details
     */
    async set<T extends JsonCompatible<any> = JsonCompatible<any>>(
        ctx: RequestContext,
        key: string,
        value: T,
    ): Promise<SetSettingsStoreValueResult>;
    /**
     * @deprecated Use `ctx` as the first argument
     */
    async set<T extends JsonCompatible<any> = JsonCompatible<any>>(
        key: string,
        value: T,
        ctx: RequestContext,
    ): Promise<SetSettingsStoreValueResult>;
    async set<T extends JsonCompatible<any> = JsonCompatible<any>>(
        keyOrCtx: string | RequestContext,
        keyOrValue: string | T,
        ctxOrValue: RequestContext | T,
    ): Promise<SetSettingsStoreValueResult> {
        // Sort out the overloaded signatures
        const ctx = keyOrCtx instanceof RequestContext ? keyOrCtx : (ctxOrValue as RequestContext);
        const key = keyOrCtx instanceof RequestContext ? (keyOrValue as string) : keyOrCtx;
        const value = ctxOrValue instanceof RequestContext ? (keyOrValue as T) : ctxOrValue;

        try {
            const fieldConfig = this.getFieldConfig(key);
            // Validate the value
            await this.validateValue(key, value, ctx);

            const scope = this.generateScope(key, value, ctx, fieldConfig);
            const repo = this.connection.getRepository(ctx, SettingsStoreEntry);

            // Find existing entry or create new one
            const entry = await repo.findOne({
                where: { key, scope },
            });

            if (entry) {
                entry.value = value;
                await repo.save(entry);
            } else {
                await repo.save({
                    key,
                    scope,
                    value,
                });
            }

            return {
                key,
                result: true,
            };
        } catch (error) {
            return {
                key,
                result: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }

    /**
     * @description
     * Set multiple values with structured result feedback for each operation.
     * This method will not throw errors but will return
     * detailed results for each key-value pair.
     */
    async setMany(
        ctx: RequestContext,
        values: Record<string, JsonCompatible<any>>,
    ): Promise<SetSettingsStoreValueResult[]>;
    /**
     * @deprecated Use `ctx` as the first argument
     */
    async setMany(
        values: Record<string, JsonCompatible<any>>,
        ctx: RequestContext,
    ): Promise<SetSettingsStoreValueResult[]>;
    async setMany(
        valuesOrCtx: Record<string, JsonCompatible<any>> | RequestContext,
        ctxOrValues: RequestContext | Record<string, JsonCompatible<any>>,
    ): Promise<SetSettingsStoreValueResult[]> {
        const { ctx, other: values } = this.determineCtx(valuesOrCtx, ctxOrValues);
        const results: SetSettingsStoreValueResult[] = [];

        for (const [key, value] of Object.entries(values)) {
            const result = await this.set(ctx, key, value);
            results.push(result);
        }

        return results;
    }

    /**
     * @description
     * Get the field configuration for a key.
     */
    getFieldDefinition(key: string): SettingsStoreFieldConfig | undefined {
        return this.fieldRegistry.get(key);
    }

    /**
     * @description
     * Returns all registered field definitions with their full keys.
     *
     * @since 3.6.0
     */
    getAllFieldDefinitions(): Array<{ key: string; config: SettingsStoreFieldConfig }> {
        return Array.from(this.fieldRegistry.entries()).map(([key, config]) => ({ key, config }));
    }

    /**
     * @description
     * Determines the scope type of a field by comparing its scope function reference
     * to the pre-built SettingsStoreScopes functions.
     *
     * @since 3.6.0
     */
    getScopeType(fieldConfig: SettingsStoreFieldConfig): SettingsStoreScopeType {
        const scope = fieldConfig.scope;
        if (!scope || scope === SettingsStoreScopes.global) return SettingsStoreScopeType.GLOBAL;
        if (scope === SettingsStoreScopes.user) return SettingsStoreScopeType.USER;
        if (scope === SettingsStoreScopes.channel) return SettingsStoreScopeType.CHANNEL;
        if (scope === SettingsStoreScopes.userAndChannel) return SettingsStoreScopeType.USER_AND_CHANNEL;
        return SettingsStoreScopeType.CUSTOM;
    }

    /**
     * @description
     * Validate a value against its field definition.
     */
    async validateValue(key: string, value: any, ctx: RequestContext): Promise<string | void> {
        const fieldConfig = this.fieldRegistry.get(key);
        if (!fieldConfig?.validate) {
            return;
        }

        const result = await fieldConfig.validate(value, this.injector, ctx);
        if (typeof result === 'string') {
            throw new UserInputError(`Validation failed for ${key}: ${result}`);
        }
        if (Array.isArray(result)) {
            throw new UserInputError(`Validation failed for ${key}: ${JSON.stringify(result)}`);
        }
    }

    /**
     * @description
     * Generate the scope key for a given field and context.
     */
    private generateScope(
        key: string,
        value: any,
        ctx: RequestContext,
        fieldConfig: SettingsStoreFieldConfig,
    ): string {
        const scopeFunction = fieldConfig.scope || SettingsStoreScopes.global;
        return scopeFunction({ key, value, ctx });
    }

    /**
     * @description
     * Get field configuration, throwing if not found.
     */
    private getFieldConfig(key: string): SettingsStoreFieldConfig {
        const config = this.fieldRegistry.get(key);
        if (!config) {
            throw new InternalServerError(`Settings store field not registered: ${key}`);
        }
        return config;
    }

    /**
     * @description
     * Find orphaned settings store entries that no longer have corresponding field definitions.
     *
     * @param options - Options for filtering orphaned entries
     * @returns Array of orphaned entries
     */
    async findOrphanedEntries(
        options: CleanupOrphanedSettingsStoreEntriesOptions = {},
    ): Promise<OrphanedSettingsStoreEntry[]> {
        const { olderThan = '7d', maxDeleteCount = 1000 } = options;

        // Parse duration to get cutoff date
        const cutoffDate = this.parseDuration(olderThan);

        const qb = this.connection.rawConnection
            .getRepository(SettingsStoreEntry)
            .createQueryBuilder('entry')
            .where('entry.updatedAt < :cutoffDate', { cutoffDate })
            .orderBy('entry.updatedAt', 'ASC')
            .limit(maxDeleteCount);

        const allEntries = await qb.getMany();
        const orphanedEntries: OrphanedSettingsStoreEntry[] = [];

        // Check each entry against registered fields
        for (const entry of allEntries) {
            const fieldConfig = this.fieldRegistry.get(entry.key);
            if (!fieldConfig) {
                // This entry has no field definition - it's orphaned
                orphanedEntries.push({
                    key: entry.key,
                    scope: entry.scope || '',
                    updatedAt: entry.updatedAt,
                    valuePreview: this.getValuePreview(entry.value),
                });
            }
        }

        return orphanedEntries;
    }

    /**
     * @description
     * Clean up orphaned settings store entries from the database.
     *
     * @param options - Options for the cleanup operation
     * @returns Result of the cleanup operation
     */
    async cleanupOrphanedEntries(
        options: CleanupOrphanedSettingsStoreEntriesOptions = {},
    ): Promise<CleanupOrphanedSettingsStoreEntriesResult> {
        const { dryRun = false, batchSize = 100, maxDeleteCount = 1000 } = options;

        // Find orphaned entries first
        const orphanedEntries = await this.findOrphanedEntries(options);

        if (dryRun) {
            return {
                deletedCount: orphanedEntries.length,
                dryRun: true,
                deletedEntries: orphanedEntries.slice(0, 10), // Sample for preview
            };
        }

        let totalDeleted = 0;
        const sampleDeletedEntries: OrphanedSettingsStoreEntry[] = [];

        // Delete in batches
        for (let i = 0; i < orphanedEntries.length && totalDeleted < maxDeleteCount; i += batchSize) {
            const batch = orphanedEntries.slice(i, i + batchSize);

            // Extract keys and scopes for deletion
            const conditions = batch.map(entry => ({ key: entry.key, scope: entry.scope }));

            await this.connection.rawConnection.getRepository(SettingsStoreEntry).delete(conditions);

            totalDeleted += batch.length;

            // Keep first batch as sample
            if (i === 0) {
                sampleDeletedEntries.push(...batch.slice(0, 10));
            }

            Logger.verbose(`Deleted batch of ${batch.length} orphaned settings store entries`);
        }

        Logger.info(`Cleanup completed: deleted ${totalDeleted} orphaned settings store entries`);

        return {
            deletedCount: totalDeleted,
            dryRun: false,
            deletedEntries: sampleDeletedEntries,
        };
    }

    /**
     * @description
     * Parse a duration string (e.g., '7d', '30m', '2h') into a Date object.
     */
    private parseDuration(duration: string): Date {
        const milliseconds = ms(duration as StringValue);
        if (!milliseconds) {
            throw new Error(`Invalid duration format: ${duration}. Use format like '7d', '2h', '30m'`);
        }

        return new Date(Date.now() - milliseconds);
    }

    /**
     * @description
     * Get a preview of a value for logging purposes, truncating if too large.
     */
    private getValuePreview(value: any): string {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        return stringValue.length > 100 ? stringValue.substring(0, 100) + '...' : stringValue;
    }

    /**
     * @description
     * Check if the current user has permission to access a field.
     * This is not called internally in the get and set methods, so should
     * be used by any methods which are exposing these methods via the GraphQL
     * APIs.
     * @deprecated Use `hasReadPermission` or `hasWritePermission` for granular control
     */
    hasPermission(ctx: RequestContext, key: string): boolean {
        // For backwards compatibility, check both read and write permissions
        return this.hasReadPermission(ctx, key) && this.hasWritePermission(ctx, key);
    }

    /**
     * @description
     * Check if the current user has permission to read a field.
     * @since 3.5.0
     */
    hasReadPermission(ctx: RequestContext, key: string): boolean {
        // Get field config first - let validation errors (like unregistered keys) bubble up
        const fieldConfig = this.getFieldConfig(key);

        try {
            const requiredPermissions = fieldConfig.requiresPermission;

            if (requiredPermissions) {
                if (this.isReadWritePermissionObject(requiredPermissions)) {
                    const readPerms = requiredPermissions.read;
                    if (readPerms) {
                        return this.checkSimplePermissions(ctx, readPerms);
                    }
                    // If no read permission specified but write is, fall back to authenticated
                    if (requiredPermissions.write) {
                        return ctx.userHasPermissions([Permission.Authenticated]);
                    }
                } else {
                    return this.checkSimplePermissions(ctx, requiredPermissions);
                }
            }

            return ctx.userHasPermissions([Permission.Authenticated]);
        } catch (error) {
            // Only catch permission evaluation errors, not field validation errors
            Logger.error(
                `Error evaluating read permissions for settings store key "${key}": ${JSON.stringify(error)}`,
            );
            return false;
        }
    }

    /**
     * @description
     * Check if the current user has permission to write a field.
     * @since 3.5.0
     */
    hasWritePermission(ctx: RequestContext, key: string): boolean {
        const fieldConfig = this.getFieldConfig(key); // Let validation errors bubble up
        try {
            const requiredPermissions = fieldConfig.requiresPermission;

            if (requiredPermissions) {
                if (this.isReadWritePermissionObject(requiredPermissions)) {
                    const writePerms = requiredPermissions.write;
                    if (writePerms) {
                        return this.checkSimplePermissions(ctx, writePerms);
                    }
                    // If no write permission specified but read is, fall back to authenticated
                    if (requiredPermissions.read) {
                        return ctx.userHasPermissions([Permission.Authenticated]);
                    }
                } else {
                    return this.checkSimplePermissions(ctx, requiredPermissions);
                }
            }

            return ctx.userHasPermissions([Permission.Authenticated]);
        } catch (error) {
            Logger.error(
                `Error evaluating write permissions for settings store key "${key}": ${JSON.stringify(error)}`,
            );
            return false;
        }
    }

    /**
     * @description
     * Helper method to check if a permission configuration is a read/write object.
     */
    private isReadWritePermissionObject(permissions: any): permissions is {
        read?: Array<Permission | string> | Permission | string;
        write?: Array<Permission | string> | Permission | string;
    } {
        return (
            typeof permissions === 'object' &&
            !Array.isArray(permissions) &&
            ('read' in permissions || 'write' in permissions)
        );
    }

    /**
     * @description
     * Helper method to check simple permissions (single permission, array, or string).
     */
    private checkSimplePermissions(
        ctx: RequestContext,
        permissions: Array<Permission | string> | Permission | string,
    ): boolean {
        const permissionArray = Array.isArray(permissions) ? permissions : [permissions];
        return ctx.userHasPermissions(permissionArray as Permission[]);
    }

    /**
     * @description
     * Returns true if the settings field has the `readonly: true` configuration.
     */
    isReadonly(key: string): boolean {
        try {
            const fieldConfig = this.getFieldConfig(key);
            return fieldConfig.readonly === true;
        } catch (error) {
            return false;
        }
    }

    /**
     * This unfortunate workaround is here because in the first version of the SettingsStore we have the
     * ctx arg last, which goes against all patterns in the rest of the code base. In v3.4.2 we overload
     * the methods to allow the correct ordering, and deprecate the original order.
     */
    private determineCtx<K>(
        a: K | RequestContext,
        b: K | RequestContext,
    ): {
        other: K;
        ctx: RequestContext;
    } {
        const ctx = a instanceof RequestContext ? a : (b as RequestContext);
        const other = a instanceof RequestContext ? (b as K) : a;
        return { other, ctx };
    }
}
