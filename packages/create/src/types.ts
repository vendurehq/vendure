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
}

export interface UserResponses extends FileSources {
    dbType: DbType;
    populateProducts: boolean;
    superadminIdentifier: string;
    superadminPassword: string;
    includeStorefront: boolean;
}

export type PackageManager = 'npm';

export type CliLogLevel = 'silent' | 'info' | 'verbose';
