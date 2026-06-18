import { select, text } from '@clack/prompts';
import { SUPER_ADMIN_USER_IDENTIFIER, SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import { randomBytes } from 'crypto';
import fs from 'fs-extra';
import Handlebars from 'handlebars';
import path from 'path';

import { checkCancel, isDockerAvailable } from './helpers';
import { DbType, FileSources, PackageManager, UserResponses } from './types';

interface PromptAnswers {
    dbType: DbType;
    dbHost: string | symbol;
    dbPort: string | symbol;
    dbName: string | symbol;
    dbSchema?: string | symbol;
    dbUserName: string | symbol;
    dbPassword: string | symbol;
    dbSSL?: boolean | symbol;
    superadminIdentifier: string | symbol;
    superadminPassword: string | symbol;
    populateProducts: boolean | symbol;
    includeStorefront: boolean | symbol;
}

/* eslint-disable no-console */

export async function getQuickStartConfiguration(
    root: string,
    packageManager: PackageManager,
    port: number,
): Promise<UserResponses> {
    // First we want to detect whether Docker is running
    const { result: dockerStatus } = await isDockerAvailable();
    let usePostgres: boolean;
    switch (dockerStatus) {
        case 'running':
            usePostgres = true;
            break;
        case 'not-found':
            usePostgres = false;
            break;
        case 'not-running': {
            let useSqlite = false;
            let dockerIsNowRunning = false;
            do {
                const useSqliteResponse = await select({
                    message: 'We could not automatically start Docker. How should we proceed?',
                    options: [
                        { label: `Let's use SQLite as the database`, value: true },
                        { label: 'I have manually started Docker', value: false },
                    ],
                    initialValue: true,
                });
                checkCancel(useSqlite);
                useSqlite = useSqliteResponse as boolean;
                if (useSqlite === false) {
                    const { result: dockerStatusManual } = await isDockerAvailable();
                    dockerIsNowRunning = dockerStatusManual === 'running';
                }
            } while (dockerIsNowRunning !== true && useSqlite === false);
            usePostgres = !useSqlite;
            break;
        }
    }

    const includeStorefront = await select({
        message: 'Would you like to include the Next.js storefront?',
        options: [
            { label: 'No', value: false },
            {
                label: 'Yes',
                value: true,
                hint: 'Adds a ready-to-use Next.js storefront connected to your Vendure server',
            },
        ],
        initialValue: false,
    });
    checkCancel(includeStorefront);

    const quickStartAnswers: PromptAnswers = {
        dbType: usePostgres ? 'postgres' : 'sqlite',
        dbHost: usePostgres ? 'localhost' : '',
        dbPort: usePostgres ? '6543' : '',
        dbName: usePostgres ? 'vendure' : '',
        dbUserName: usePostgres ? 'vendure' : '',
        dbPassword: usePostgres ? randomBytes(16).toString('base64url') : '',
        dbSchema: usePostgres ? 'public' : '',
        populateProducts: true,
        superadminIdentifier: SUPER_ADMIN_USER_IDENTIFIER,
        superadminPassword: SUPER_ADMIN_USER_PASSWORD,
        includeStorefront,
    };

    const responses = {
        ...(await generateSources(root, quickStartAnswers, packageManager, port)),
        dbType: quickStartAnswers.dbType,
        populateProducts: quickStartAnswers.populateProducts as boolean,
        superadminIdentifier: quickStartAnswers.superadminIdentifier as string,
        superadminPassword: quickStartAnswers.superadminPassword as string,
        includeStorefront: includeStorefront as boolean,
    };

    return responses;
}

/**
 * Prompts the user to determine how the new Vendure app should be configured.
 */
export async function getManualConfiguration(
    root: string,
    packageManager: PackageManager,
    port: number,
): Promise<UserResponses> {
    const dbType = (await select({
        message: 'Which database are you using?',
        options: [
            { label: 'MySQL', value: 'mysql' },
            { label: 'MariaDB', value: 'mariadb' },
            { label: 'Postgres', value: 'postgres' },
            { label: 'SQLite', value: 'sqlite' },
        ],
        initialValue: 'sqlite' as DbType,
    })) as DbType;
    checkCancel(dbType);

    const hasConnection = dbType !== 'sqlite';
    const dbHost = hasConnection
        ? await text({
              message: "What's the database host address?",
              initialValue: 'localhost',
          })
        : '';
    checkCancel(dbHost);
    const dbPort = hasConnection
        ? await text({
              message: 'What port is the database listening on?',
              initialValue: defaultDBPort(dbType).toString(),
          })
        : '';
    checkCancel(dbPort);
    const dbName = hasConnection
        ? await text({
              message: "What's the name of the database?",
              initialValue: 'vendure',
          })
        : '';
    checkCancel(dbName);
    const dbSchema =
        dbType === 'postgres'
            ? await text({
                  message: "What's the schema name we should use?",
                  initialValue: 'public',
              })
            : '';
    checkCancel(dbSchema);
    const dbSSL =
        dbType === 'postgres'
            ? await select({
                  message:
                      'Use SSL to connect to the database? (only enable if your database provider supports SSL)',
                  options: [
                      { label: 'no', value: false },
                      { label: 'yes', value: true },
                  ],
                  initialValue: false,
              })
            : false;
    checkCancel(dbSSL);
    const dbUserName = hasConnection
        ? await text({
              message: "What's the database user name?",
          })
        : '';
    checkCancel(dbUserName);
    const dbPassword = hasConnection
        ? await text({
              message: "What's the database password?",
              defaultValue: '',
          })
        : '';
    checkCancel(dbPassword);
    const superadminIdentifier = await text({
        message: 'What identifier do you want to use for the superadmin user?',
        initialValue: SUPER_ADMIN_USER_IDENTIFIER,
    });
    checkCancel(superadminIdentifier);
    const superadminPassword = await text({
        message: 'What password do you want to use for the superadmin user?',
        initialValue: SUPER_ADMIN_USER_PASSWORD,
    });
    checkCancel(superadminPassword);
    const populateProducts = await select({
        message: 'Populate with some sample product data?',
        options: [
            { label: 'yes', value: true },
            { label: 'no', value: false },
        ],
        initialValue: true,
    });
    checkCancel(populateProducts);

    const includeStorefront = await select({
        message: 'Would you like to include the Next.js storefront?',
        options: [
            { label: 'No', value: false },
            {
                label: 'Yes',
                value: true,
                hint: 'Adds a ready-to-use Next.js storefront connected to your Vendure server',
            },
        ],
        initialValue: false,
    });
    checkCancel(includeStorefront);

    const answers: PromptAnswers = {
        dbType,
        dbHost,
        dbPort,
        dbName,
        dbSchema,
        dbUserName,
        dbPassword,
        dbSSL,
        superadminIdentifier,
        superadminPassword,
        populateProducts,
        includeStorefront,
    };

    return {
        ...(await generateSources(root, answers, packageManager, port)),
        dbType,
        populateProducts: answers.populateProducts as boolean,
        superadminIdentifier: answers.superadminIdentifier as string,
        superadminPassword: answers.superadminPassword as string,
        includeStorefront: includeStorefront as boolean,
    };
}

/**
 * Returns mock "user response" without prompting, for use in CI
 */
export async function getCiConfiguration(
    root: string,
    packageManager: PackageManager,
    port: number,
    includeStorefront: boolean = false,
): Promise<UserResponses> {
    const ciAnswers = {
        dbType: 'sqlite' as const,
        dbHost: '',
        dbPort: '',
        dbName: 'vendure',
        dbUserName: '',
        dbPassword: '',
        populateProducts: true,
        superadminIdentifier: SUPER_ADMIN_USER_IDENTIFIER,
        superadminPassword: SUPER_ADMIN_USER_PASSWORD,
        includeStorefront,
    };

    return {
        ...(await generateSources(root, ciAnswers, packageManager, port)),
        dbType: ciAnswers.dbType,
        populateProducts: ciAnswers.populateProducts,
        superadminIdentifier: ciAnswers.superadminIdentifier,
        superadminPassword: ciAnswers.superadminPassword,
        includeStorefront,
    };
}

/**
 * Create the server index, worker and config source code based on the options specified by the CLI prompts.
 */
async function generateSources(
    root: string,
    answers: PromptAnswers,
    packageManager: PackageManager,
    port: number,
): Promise<FileSources> {
    const assetPath = (fileName: string) => path.join(__dirname, '../assets', fileName);

    /**
     * Helper to escape single quotes only. Used when generating the config file since e.g. passwords
     * might use special chars (`< > ' "` etc) which Handlebars would be default convert to HTML entities.
     * Instead, we disable escaping and use this custom helper to escape only the single quote character.
     */
    Handlebars.registerHelper('escapeSingle', (aString: unknown) => {
        return typeof aString === 'string' ? aString.replace(/'/g, "\\'") : aString;
    });

    const templateContext = {
        ...answers,
        dbType: answers.dbType === 'sqlite' ? 'better-sqlite3' : answers.dbType,
        name: path.basename(root),
        isSQLite: answers.dbType === 'sqlite',
        requiresConnection: answers.dbType !== 'sqlite',
        cookieSecret: randomBytes(16).toString('base64url'),
        port,
        isMonorepo: answers.includeStorefront,
    };

    async function createSourceFile(filename: string, noEscape = false): Promise<string> {
        const template = await fs.readFile(assetPath(filename), 'utf-8');
        return Handlebars.compile(template, { noEscape })(templateContext);
    }

    return {
        indexSource: await createSourceFile('index.hbs'),
        indexWorkerSource: await createSourceFile('index-worker.hbs'),
        configSource: await createSourceFile('vendure-config.hbs', true),
        envSource: await createSourceFile('.env.hbs', true),
        envDtsSource: await createSourceFile('environment.d.hbs', true),
        readmeSource: await createSourceFile('readme.hbs'),
        dockerfileSource: await createSourceFile('Dockerfile.hbs'),
        dockerComposeSource: await createSourceFile('docker-compose.hbs'),
        tsconfigDashboardSource: await createSourceFile('tsconfig.dashboard.hbs'),
        viteConfigSource: await createSourceFile('vite.config.hbs'),
    };
}

function defaultDBPort(dbType: DbType): number {
    switch (dbType) {
        case 'mysql':
        case 'mariadb':
            return 3306;
        case 'postgres':
            return 5432;
        default:
            return 3306;
    }
}
