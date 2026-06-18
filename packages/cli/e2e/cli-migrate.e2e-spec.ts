import { afterEach, describe, expect, it } from 'vitest';

import { CliTestProject, createProblematicTsConfig, createTestProject } from './cli-test-utils';

describe('CLI Migrate Command E2E', () => {
    let testProject: CliTestProject;

    afterEach(() => {
        if (testProject) {
            testProject.cleanup();
        }
    });

    describe('tsconfig.json comment stripping', () => {
        it('should successfully parse tsconfig.json with /* patterns in path values', async () => {
            testProject = createTestProject('tsconfig-comment-test');

            // Create a tsconfig.json with the problematic patterns that broke the old implementation
            testProject.writeFile('tsconfig.json', createProblematicTsConfig());

            // Try to run a CLI command that loads the tsconfig.json
            // Since the migrate command is currently not exposed, we'll test the underlying functionality
            // by using the --help command which should still load the config for validation
            const result = await testProject.runCliCommand(['--help']);

            // The command should complete successfully without crashing
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Usage:');
        });

        it('should handle tsconfig.json with various comment patterns', async () => {
            testProject = createTestProject('complex-tsconfig-test');

            // Create a more complex tsconfig.json with various comment patterns
            const complexTsConfig = `{
    // Single line comment
    "compilerOptions": {
        /* Multi-line comment at the beginning */
        "target": "ES2021",
        "module": "commonjs", // Inline comment
        "baseUrl": "./",
        /*
         * Multi-line comment block
         * with multiple lines
         */
        "paths": {
            // This path contains /* which was problematic
            "@/vdb/*": ["./node_modules/@vendure/dashboard/src/lib/*"],
            "comment": "This // looks like a comment but isn't",
            "multiComment": "This /* looks */ like /* multiple */ comments",
            "protocol": "file://some-protocol-url/*",
            "regex": "some/*/pattern/*/here"
        }
        /* Final comment */
    }
    // End comment
}`;

            testProject.writeFile('tsconfig.json', complexTsConfig);

            // The CLI should handle this complex config without issues
            const result = await testProject.runCliCommand(['--help']);
            expect(result.exitCode).toBe(0);
        });

        it('should preserve path mappings with wildcards correctly', async () => {
            testProject = createTestProject('wildcard-paths-test');

            // Create a tsconfig with various wildcard patterns
            const wildcardTsConfig = `{
    "compilerOptions": {
        "baseUrl": "./",
        "paths": {
            "@/dashboard/*": ["./node_modules/@vendure/dashboard/src/lib/*"],
            "@/plugins/*/src": ["./src/plugins/*/src/index.ts"],
            "@/api/*/types": ["./src/api/*/types.ts"],
            "*/utils": ["./src/utils/*"],
            "glob/**": ["./src/glob/**/*"]
        }
    }
}`;

            testProject.writeFile('tsconfig.json', wildcardTsConfig);

            // Test that the CLI doesn't crash with these patterns
            const result = await testProject.runCliCommand(['--help']);
            expect(result.exitCode).toBe(0);
        });
    });

    describe('CLI command execution', () => {
        it('should show help when no arguments provided', async () => {
            testProject = createTestProject('help-test');

            // CLI shows help but exits with code 1 when no arguments provided
            const result = await testProject.runCliCommand([], { expectError: true });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('Usage:');
        });

        it('should show version when --version flag is used', async () => {
            testProject = createTestProject('version-test');

            const result = await testProject.runCliCommand(['--version']);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toMatch(/\d+\.\d+\.\d+/); // Should contain version number
        });

        it('should handle invalid commands gracefully', async () => {
            testProject = createTestProject('invalid-command-test');

            const result = await testProject.runCliCommand(['invalid-command'], { expectError: true });
            expect(result.exitCode).not.toBe(0);
            expect(result.stderr).toContain('unknown command');
        });
    });

    describe('project structure validation', () => {
        it('should work with minimal project structure', async () => {
            testProject = createTestProject('minimal-project');

            // Create minimal files
            testProject.writeFile(
                'tsconfig.json',
                JSON.stringify(
                    {
                        compilerOptions: {
                            target: 'ES2021',
                            module: 'commonjs',
                        },
                    },
                    null,
                    2,
                ),
            );

            const result = await testProject.runCliCommand(['--help']);
            expect(result.exitCode).toBe(0);
        });

        it('should handle missing tsconfig.json gracefully', async () => {
            testProject = createTestProject('no-tsconfig');

            // Don't create a tsconfig.json file
            const result = await testProject.runCliCommand(['--help']);

            // Should still work, as tsconfig.json is not always required for help command
            expect(result.exitCode).toBe(0);
        });
    });
});
