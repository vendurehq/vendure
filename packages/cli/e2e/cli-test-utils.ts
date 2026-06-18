import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CliTestProject {
    projectDir: string;
    cleanup: () => void;
    writeFile: (relativePath: string, content: string) => void;
    readFile: (relativePath: string) => string;
    fileExists: (relativePath: string) => boolean;
    runCliCommand: (
        args: string[],
        options?: { expectError?: boolean },
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/**
 * Creates a temporary test project for CLI testing
 */
export function createTestProject(projectName: string = 'test-project'): CliTestProject {
    const projectDir = join(
        tmpdir(),
        'vendure-cli-e2e',
        `${projectName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    );

    // Create project directory
    mkdirSync(projectDir, { recursive: true });

    // Create basic package.json
    const packageJson = {
        name: projectName,
        version: '1.0.0',
        private: true,
        dependencies: {
            '@vendure/core': '3.3.7',
            '@vendure/common': '3.3.7',
        },
        devDependencies: {
            typescript: '5.8.2',
        },
    };

    writeFileSync(join(projectDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    // Create basic vendure-config.ts
    const vendureConfig = `
import { VendureConfig, NoopLogger } from '@vendure/core';

export const config: VendureConfig = {
    apiOptions: {
        port: 3000,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
    },
    logger: new NoopLogger(),
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: 'superadmin',
            password: 'superadmin',
        },
        cookieOptions: {
            secret: 'cookie-secret',
        },
    },
    dbConnectionOptions: {
        type: 'better-sqlite3',
        database: ':memory:',
        synchronize: true,
    },
};
`;

    writeFileSync(join(projectDir, 'vendure-config.ts'), vendureConfig);

    return {
        projectDir,
        cleanup: () => {
            try {
                rmSync(projectDir, { recursive: true, force: true });
            } catch (error) {
                // Ignore cleanup errors - use stderr to avoid no-console lint error
                const errorMessage = error instanceof Error ? error.message : String(error);
                process.stderr.write(`Failed to cleanup test project at ${projectDir}: ${errorMessage}\n`);
            }
        },
        writeFile: (relativePath: string, content: string) => {
            const fullPath = join(projectDir, relativePath);
            const dir = join(fullPath, '..');
            mkdirSync(dir, { recursive: true });
            writeFileSync(fullPath, content);
        },
        readFile: (relativePath: string) => {
            return readFileSync(join(projectDir, relativePath), 'utf-8');
        },
        fileExists: (relativePath: string) => {
            return existsSync(join(projectDir, relativePath));
        },
        runCliCommand: async (args: string[], options: { expectError?: boolean } = {}) => {
            return new Promise((resolve, reject) => {
                // Use the built CLI from the dist directory
                const cliPath = join(__dirname, '..', 'dist', 'cli.js');

                const child = spawn('node', [cliPath, ...args], {
                    cwd: projectDir,
                    env: {
                        ...process.env,
                        // Ensure we don't inherit any CLI environment variables
                        VENDURE_RUNNING_IN_CLI: undefined,
                    },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                let stdout = '';
                let stderr = '';

                child.stdout?.on('data', data => {
                    stdout += data.toString();
                });

                child.stderr?.on('data', data => {
                    stderr += data.toString();
                });

                child.on('close', code => {
                    const exitCode = code ?? 0;

                    if (!options.expectError && exitCode !== 0) {
                        reject(new Error(`CLI command failed with exit code ${exitCode}. stderr: ${stderr}`));
                    } else {
                        resolve({ stdout, stderr, exitCode });
                    }
                });

                child.on('error', error => {
                    reject(error);
                });

                // Send empty stdin to handle any prompts (for non-interactive testing)
                child.stdin?.end();
            });
        },
    };
}

/**
 * Creates a tsconfig.json with the problematic patterns that caused the original bug
 */
export function createProblematicTsConfig(): string {
    return `{
    // TypeScript configuration file with comments
    "compilerOptions": {
        "target": "ES2021",
        "module": "commonjs",
        "lib": ["ES2021"],
        "outDir": "./dist",
        "rootDir": "./src",
        "baseUrl": "./",
        /* Path mappings that contain /* patterns in strings - this was breaking the old regex implementation */
        "paths": {
            "@/vdb/*": ["./node_modules/@vendure/dashboard/src/lib/*"],
            "@/components/*": ["src/components/*"],
            "@/api/*": ["./api/*/index.ts"],
            "@/plugins/*": ["./src/plugins/*/src/index.ts"],
            "special": "path/with/*/wildcards"
        },
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true
    },
    "include": ["src/**/*", "vendure-config.ts"],
    "exclude": ["node_modules", "dist"]
}`;
}

/**
 * Waits for a condition to be true with timeout
 */
export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 5000,
    intervalMs: number = 100,
): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        if (await condition()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Condition not met within ${timeoutMs}ms`);
}
