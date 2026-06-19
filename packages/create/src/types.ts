export type DbType = 'mysql' | 'mariadb' | 'postgres' | 'sqlite';
export type LintTool = 'eslint' | 'biome' | 'none';

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
    eslintConfigSource: string;
    biomeConfigSource: string;
    biomeNoProcessEnvInPluginSource: string;
    biomeNoSynchronizeTrueSource: string;
    biomeNoRawRequestContextInJobDataSource: string;
}

export interface UserResponses extends FileSources {
    dbType: DbType;
    populateProducts: boolean;
    superadminIdentifier: string;
    superadminPassword: string;
    includeStorefront: boolean;
    lintTool: LintTool;
}

export type PackageManager = 'npm';

export type CliLogLevel = 'silent' | 'info' | 'verbose';
