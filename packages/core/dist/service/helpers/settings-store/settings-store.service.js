"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsStoreService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const generated_types_1 = require("@vendure/common/lib/generated-types");
const ms_1 = __importDefault(require("ms"));
const request_context_1 = require("../../../api/common/request-context");
const errors_1 = require("../../../common/error/errors");
const injector_1 = require("../../../common/injector");
const config_service_1 = require("../../../config/config.service");
const vendure_logger_1 = require("../../../config/logger/vendure-logger");
const settings_store_types_1 = require("../../../config/settings-store/settings-store-types");
const transactional_connection_1 = require("../../../connection/transactional-connection");
const settings_store_entry_entity_1 = require("../../../entity/settings-store-entry/settings-store-entry.entity");
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
let SettingsStoreService = class SettingsStoreService {
    constructor(connection, moduleRef, configService) {
        this.connection = connection;
        this.moduleRef = moduleRef;
        this.configService = configService;
        this.fieldRegistry = new Map();
        this.injector = new injector_1.Injector(this.moduleRef);
    }
    onModuleInit() {
        this.initializeFieldRegistrations();
    }
    /**
     * @description
     * Initialize field registrations from the Vendure configuration.
     * Called during module initialization.
     */
    initializeFieldRegistrations() {
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
    register(registration) {
        for (const field of registration.fields) {
            const fullKey = `${registration.namespace}.${field.name}`;
            this.fieldRegistry.set(fullKey, field);
            vendure_logger_1.Logger.debug(`Registered settings store field: ${fullKey}`);
        }
    }
    async get(keyOrCtx, ctxOrKey) {
        const { ctx, other: key } = this.determineCtx(keyOrCtx, ctxOrKey);
        const fieldConfig = this.getFieldConfig(key);
        const scope = this.generateScope(key, undefined, ctx, fieldConfig);
        const entry = await this.connection.getRepository(ctx, settings_store_entry_entity_1.SettingsStoreEntry).findOne({
            where: { key, scope },
        });
        return entry === null || entry === void 0 ? void 0 : entry.value;
    }
    async getMany(keysOrCtx, ctxOrKeys) {
        const { ctx, other: keys } = this.determineCtx(keysOrCtx, ctxOrKeys);
        const result = {};
        // Build array of key/scopeKey pairs for authorized keys
        const queries = [];
        for (const key of keys) {
            const fieldConfig = this.getFieldConfig(key);
            const scope = this.generateScope(key, undefined, ctx, fieldConfig);
            queries.push({ key, scope });
        }
        if (queries.length === 0) {
            return result;
        }
        // Execute single query for all authorized keys using OR conditions
        const qb = this.connection.getRepository(ctx, settings_store_entry_entity_1.SettingsStoreEntry).createQueryBuilder('entry');
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
    async set(keyOrCtx, keyOrValue, ctxOrValue) {
        // Sort out the overloaded signatures
        const ctx = keyOrCtx instanceof request_context_1.RequestContext ? keyOrCtx : ctxOrValue;
        const key = keyOrCtx instanceof request_context_1.RequestContext ? keyOrValue : keyOrCtx;
        const value = ctxOrValue instanceof request_context_1.RequestContext ? keyOrValue : ctxOrValue;
        try {
            const fieldConfig = this.getFieldConfig(key);
            // Validate the value
            await this.validateValue(key, value, ctx);
            const scope = this.generateScope(key, value, ctx, fieldConfig);
            const repo = this.connection.getRepository(ctx, settings_store_entry_entity_1.SettingsStoreEntry);
            // Find existing entry or create new one
            const entry = await repo.findOne({
                where: { key, scope },
            });
            if (entry) {
                entry.value = value;
                await repo.save(entry);
            }
            else {
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
        }
        catch (error) {
            return {
                key,
                result: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }
    async setMany(valuesOrCtx, ctxOrValues) {
        const { ctx, other: values } = this.determineCtx(valuesOrCtx, ctxOrValues);
        const results = [];
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
    getFieldDefinition(key) {
        return this.fieldRegistry.get(key);
    }
    /**
     * @description
     * Returns all registered field definitions with their full keys.
     *
     * @since 3.6.0
     */
    getAllFieldDefinitions() {
        return Array.from(this.fieldRegistry.entries()).map(([key, config]) => ({ key, config }));
    }
    /**
     * @description
     * Determines the scope type of a field by comparing its scope function reference
     * to the pre-built SettingsStoreScopes functions.
     *
     * @since 3.6.0
     */
    getScopeType(fieldConfig) {
        const scope = fieldConfig.scope;
        if (!scope || scope === settings_store_types_1.SettingsStoreScopes.global)
            return generated_types_1.SettingsStoreScopeType.GLOBAL;
        if (scope === settings_store_types_1.SettingsStoreScopes.user)
            return generated_types_1.SettingsStoreScopeType.USER;
        if (scope === settings_store_types_1.SettingsStoreScopes.channel)
            return generated_types_1.SettingsStoreScopeType.CHANNEL;
        if (scope === settings_store_types_1.SettingsStoreScopes.userAndChannel)
            return generated_types_1.SettingsStoreScopeType.USER_AND_CHANNEL;
        return generated_types_1.SettingsStoreScopeType.CUSTOM;
    }
    /**
     * @description
     * Validate a value against its field definition.
     */
    async validateValue(key, value, ctx) {
        const fieldConfig = this.fieldRegistry.get(key);
        if (!(fieldConfig === null || fieldConfig === void 0 ? void 0 : fieldConfig.validate)) {
            return;
        }
        const result = await fieldConfig.validate(value, this.injector, ctx);
        if (typeof result === 'string') {
            throw new errors_1.UserInputError(`Validation failed for ${key}: ${result}`);
        }
        if (Array.isArray(result)) {
            throw new errors_1.UserInputError(`Validation failed for ${key}: ${JSON.stringify(result)}`);
        }
    }
    /**
     * @description
     * Generate the scope key for a given field and context.
     */
    generateScope(key, value, ctx, fieldConfig) {
        const scopeFunction = fieldConfig.scope || settings_store_types_1.SettingsStoreScopes.global;
        return scopeFunction({ key, value, ctx });
    }
    /**
     * @description
     * Get field configuration, throwing if not found.
     */
    getFieldConfig(key) {
        const config = this.fieldRegistry.get(key);
        if (!config) {
            // 未注册的 key 属于调用方入参错误，应返回 BAD_USER_INPUT 而非 500
            throw new errors_1.UserInputError(`Settings store field not registered: ${key}`);
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
    async findOrphanedEntries(options = {}) {
        const { olderThan = '7d', maxDeleteCount = 1000 } = options;
        // Parse duration to get cutoff date
        const cutoffDate = this.parseDuration(olderThan);
        const qb = this.connection.rawConnection
            .getRepository(settings_store_entry_entity_1.SettingsStoreEntry)
            .createQueryBuilder('entry')
            .where('entry.updatedAt < :cutoffDate', { cutoffDate })
            .orderBy('entry.updatedAt', 'ASC')
            .limit(maxDeleteCount);
        const allEntries = await qb.getMany();
        const orphanedEntries = [];
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
    async cleanupOrphanedEntries(options = {}) {
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
        const sampleDeletedEntries = [];
        // Delete in batches
        for (let i = 0; i < orphanedEntries.length && totalDeleted < maxDeleteCount; i += batchSize) {
            const batch = orphanedEntries.slice(i, i + batchSize);
            // Extract keys and scopes for deletion
            const conditions = batch.map(entry => ({ key: entry.key, scope: entry.scope }));
            // typeorm 0.3.21 的 delete() 把数组 criteria 一律按 ID 数组处理（whereInIds），
            // 复合 (key, scope) 条件必须用 orWhere 显式表达；scope 可为 null（IS NULL 语义）。
            const deleteQb = this.connection.rawConnection
                .getRepository(settings_store_entry_entity_1.SettingsStoreEntry)
                .createQueryBuilder()
                .delete();
            conditions.forEach((condition, index) => {
                if (condition.scope === null || condition.scope === undefined) {
                    deleteQb.orWhere(`key = :key${index} AND scope IS NULL`, {
                        [`key${index}`]: condition.key,
                    });
                }
                else {
                    deleteQb.orWhere(`key = :key${index} AND scope = :scope${index}`, {
                        [`key${index}`]: condition.key,
                        [`scope${index}`]: condition.scope,
                    });
                }
            });
            await deleteQb.execute();
            totalDeleted += batch.length;
            // Keep first batch as sample
            if (i === 0) {
                sampleDeletedEntries.push(...batch.slice(0, 10));
            }
            vendure_logger_1.Logger.verbose(`Deleted batch of ${batch.length} orphaned settings store entries`);
        }
        vendure_logger_1.Logger.info(`Cleanup completed: deleted ${totalDeleted} orphaned settings store entries`);
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
    parseDuration(duration) {
        const milliseconds = (0, ms_1.default)(duration);
        if (!milliseconds) {
            throw new Error(`Invalid duration format: ${duration}. Use format like '7d', '2h', '30m'`);
        }
        return new Date(Date.now() - milliseconds);
    }
    /**
     * @description
     * Get a preview of a value for logging purposes, truncating if too large.
     */
    getValuePreview(value) {
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
    hasPermission(ctx, key) {
        // For backwards compatibility, check both read and write permissions
        return this.hasReadPermission(ctx, key) && this.hasWritePermission(ctx, key);
    }
    /**
     * @description
     * Check if the current user has permission to read a field.
     * @since 3.5.0
     */
    hasReadPermission(ctx, key) {
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
                        return ctx.userHasPermissions([generated_types_1.Permission.Authenticated]);
                    }
                }
                else {
                    return this.checkSimplePermissions(ctx, requiredPermissions);
                }
            }
            return ctx.userHasPermissions([generated_types_1.Permission.Authenticated]);
        }
        catch (error) {
            // Only catch permission evaluation errors, not field validation errors
            vendure_logger_1.Logger.error(`Error evaluating read permissions for settings store key "${key}": ${JSON.stringify(error)}`);
            return false;
        }
    }
    /**
     * @description
     * Check if the current user has permission to write a field.
     * @since 3.5.0
     */
    hasWritePermission(ctx, key) {
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
                        return ctx.userHasPermissions([generated_types_1.Permission.Authenticated]);
                    }
                }
                else {
                    return this.checkSimplePermissions(ctx, requiredPermissions);
                }
            }
            return ctx.userHasPermissions([generated_types_1.Permission.Authenticated]);
        }
        catch (error) {
            vendure_logger_1.Logger.error(`Error evaluating write permissions for settings store key "${key}": ${JSON.stringify(error)}`);
            return false;
        }
    }
    /**
     * @description
     * Helper method to check if a permission configuration is a read/write object.
     */
    isReadWritePermissionObject(permissions) {
        return (typeof permissions === 'object' &&
            !Array.isArray(permissions) &&
            ('read' in permissions || 'write' in permissions));
    }
    /**
     * @description
     * Helper method to check simple permissions (single permission, array, or string).
     */
    checkSimplePermissions(ctx, permissions) {
        const permissionArray = Array.isArray(permissions) ? permissions : [permissions];
        return ctx.userHasPermissions(permissionArray);
    }
    /**
     * @description
     * Returns true if the settings field has the `readonly: true` configuration.
     */
    isReadonly(key) {
        try {
            const fieldConfig = this.getFieldConfig(key);
            return fieldConfig.readonly === true;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * This unfortunate workaround is here because in the first version of the SettingsStore we have the
     * ctx arg last, which goes against all patterns in the rest of the code base. In v3.4.2 we overload
     * the methods to allow the correct ordering, and deprecate the original order.
     */
    determineCtx(a, b) {
        const ctx = a instanceof request_context_1.RequestContext ? a : b;
        const other = a instanceof request_context_1.RequestContext ? b : a;
        return { other, ctx };
    }
};
exports.SettingsStoreService = SettingsStoreService;
exports.SettingsStoreService = SettingsStoreService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [transactional_connection_1.TransactionalConnection,
        core_1.ModuleRef,
        config_service_1.ConfigService])
], SettingsStoreService);
//# sourceMappingURL=settings-store.service.js.map