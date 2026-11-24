import type { StorefrontId } from './storefront-starters.js';
import type { CreateRecordPackageManager } from '@vendure/common/lib/create-record';

export type DbType = 'mysql' | 'mariadb' | 'postgres' | 'sqlite';

export interface FileSources {
    indexSource: string;
    indexWorkerSource: string;
    configSource: string;
    envSource: string;
    envDtsSource: string;
    readmeSource: string;
    dockerfileSource: string;
    dockerComposeSource: string;
    tsconfigDashboardSource: string;
    viteConfigSource: string;
    agentsSource: string;
}

export interface UserResponses extends FileSources {
    dbType: DbType;
    populateProducts: boolean;
    superadminIdentifier: string;
    superadminPassword: string;
    storefront?: StorefrontId;
    storefrontPort: number;
}

/** The package managers create supports. It is the list `.vendure/create.json` can record. */
export type PackageManager = CreateRecordPackageManager;

export type CliLogLevel = 'silent' | 'info' | 'verbose';
