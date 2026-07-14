import { Injectable, OnModuleInit } from '@nestjs/common';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { RequestContext } from '../../api/common/request-context';
import { SettingsStoreScopes } from '../../config/settings-store/settings-store-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { SettingsStoreService } from '../../service/helpers/settings-store/settings-store.service';

const SETTINGS_KEY = 'telemetry.installationId';

/**
 * Manages a persistent installation ID for telemetry purposes.
 * The ID is a random UUID stored primarily in the database via SettingsStoreService,
 * with a filesystem fallback at .vendure/.installation-id for when the DB is unavailable.
 *
 * Using the database ensures the installation ID persists across container restarts
 * in containerized deployments (Docker, K8s).
 */
@Injectable()
export class InstallationIdCollector implements OnModuleInit {
    private cachedId: string | undefined;

    constructor(
        private readonly settingsStoreService: SettingsStoreService,
        private readonly connection: TransactionalConnection,
    ) {}

    onModuleInit() {
        this.settingsStoreService.register({
            namespace: 'telemetry',
            fields: [{ name: 'installationId', scope: SettingsStoreScopes.global, readonly: true }],
        });
    }

    /**
     * Returns the installation ID, creating one if it doesn't exist.
     * Checks DB first, then filesystem, then generates a new one.
     */
    async collect(): Promise<string> {
        if (this.cachedId) {
            return this.cachedId;
        }

        // 1. Try database
        const dbId = await this.readFromDatabase();
        if (dbId) {
            this.cachedId = dbId;
            return dbId;
        }

        // 2. Try filesystem
        const fsId = this.readFromFilesystem();
        if (fsId) {
            // Migrate filesystem ID to database
            await this.saveToDatabase(fsId);
            this.cachedId = fsId;
            return fsId;
        }

        // 3. Generate new ID
        const newId = crypto.randomUUID();
        await this.saveToDatabase(newId);
        this.saveToFilesystem(newId);
        this.cachedId = newId;
        return newId;
    }

    private async readFromDatabase(): Promise<string | undefined> {
        try {
            if (!this.connection.rawConnection?.isInitialized) {
                return undefined;
            }
            const value = await this.settingsStoreService.get(RequestContext.empty(), SETTINGS_KEY);
            if (typeof value === 'string' && this.isValidUUID(value)) {
                return value;
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    private async saveToDatabase(id: string): Promise<void> {
        try {
            if (!this.connection.rawConnection?.isInitialized) {
                return;
            }
            await this.settingsStoreService.set(RequestContext.empty(), SETTINGS_KEY, id as any);
        } catch {
            // Best-effort: silently ignore DB write failures
        }
    }

    private readFromFilesystem(): string | undefined {
        try {
            const idPath = this.getInstallationIdPath();
            if (fs.existsSync(idPath)) {
                const existingId = fs.readFileSync(idPath, 'utf-8').trim();
                if (existingId && this.isValidUUID(existingId)) {
                    return existingId;
                }
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    private saveToFilesystem(id: string): void {
        try {
            const idPath = this.getInstallationIdPath();
            const vendureDir = path.dirname(idPath);
            fs.mkdirSync(vendureDir, { recursive: true });
            fs.writeFileSync(idPath, id, 'utf-8');
        } catch {
            // Best-effort: silently ignore filesystem write failures
        }
    }

    private getInstallationIdPath(): string {
        // Find the project root by looking for node_modules
        let currentDir = process.cwd();

        // Walk up to find project root (where node_modules is)
        while (currentDir !== path.dirname(currentDir)) {
            if (fs.existsSync(path.join(currentDir, 'node_modules'))) {
                return path.join(currentDir, '.vendure', '.installation-id');
            }
            currentDir = path.dirname(currentDir);
        }

        // Fallback to cwd
        return path.join(process.cwd(), '.vendure', '.installation-id');
    }

    private isValidUUID(str: string): boolean {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(str);
    }
}
