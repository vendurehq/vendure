import stripJsonComments from 'strip-json-comments';
import { describe, expect, it } from 'vitest';

describe('stripJsonComments', () => {
    it('should handle JSON with /* in string values correctly', () => {
        const input = `{
            "compilerOptions": {
                "paths": {
                    "@/vdb/*": ["./node_modules/@vendure/dashboard/src/lib/*"]
                }
            }
        }`;

        const result = stripJsonComments(input);
        const parsed = JSON.parse(result);

        expect(parsed.compilerOptions.paths['@/vdb/*']).toEqual([
            './node_modules/@vendure/dashboard/src/lib/*',
        ]);
    });

    it('should remove actual comments while preserving /* in strings', () => {
        const input = `{
            // This is a comment
            "compilerOptions": {
                /* Multi-line comment */
                "paths": {
                    "@/vdb/*": ["./node_modules/@vendure/dashboard/src/lib/*"],
                    "test": "value with /* inside string"
                }
            }
        }`;

        const result = stripJsonComments(input);
        const parsed = JSON.parse(result);

        expect(parsed.compilerOptions.paths['@/vdb/*']).toEqual([
            './node_modules/@vendure/dashboard/src/lib/*',
        ]);
        expect(parsed.compilerOptions.paths.test).toBe('value with /* inside string');
    });

    it('should handle complex paths with wildcards and comments', () => {
        const input = `{
            "compilerOptions": {
                "baseUrl": "./",
                // Comment about paths
                "paths": {
                    "@/*": ["src/*"],
                    "@/components/*": ["src/components/*"],
                    "@/vendor/*": ["./node_modules/@vendure/*/src/*"],
                    "special": "path/with/*/wildcards"
                }
            }
        }`;

        const result = stripJsonComments(input);
        const parsed = JSON.parse(result);

        expect(parsed.compilerOptions.paths['@/vendor/*']).toEqual(['./node_modules/@vendure/*/src/*']);
        expect(parsed.compilerOptions.paths.special).toBe('path/with/*/wildcards');
    });

    it('should handle nested /* patterns in strings', () => {
        const input = `{
            "test": {
                "pattern1": "/* comment inside string */",
                "pattern2": "start /* middle */ end",
                "pattern3": "multiple /* one */ and /* two */"
            }
        }`;

        const result = stripJsonComments(input);
        const parsed = JSON.parse(result);

        expect(parsed.test.pattern1).toBe('/* comment inside string */');
        expect(parsed.test.pattern2).toBe('start /* middle */ end');
        expect(parsed.test.pattern3).toBe('multiple /* one */ and /* two */');
    });

    it('should handle // patterns in strings', () => {
        const input = `{
            // Real comment
            "url": "https://example.com/path",
            "comment": "This // is not a comment"
        }`;

        const result = stripJsonComments(input);
        const parsed = JSON.parse(result);

        expect(parsed.url).toBe('https://example.com/path');
        expect(parsed.comment).toBe('This // is not a comment');
    });
});

describe('JSON parsing with comments', () => {
    it('should successfully parse tsconfig.json content with /* in paths', () => {
        const tsConfigContent = `{
            "compilerOptions": {
                "baseUrl": "./",
                "paths": {
                    "@/vdb/*": ["./node_modules/@vendure/dashboard/src/lib/*"]
                }
            }
        }`;

        // This should not throw an error when parsing
        const result = JSON.parse(stripJsonComments(tsConfigContent));
        expect(result.compilerOptions.paths['@/vdb/*']).toEqual([
            './node_modules/@vendure/dashboard/src/lib/*',
        ]);
    });

    it('should handle tsconfig.json with comments and /* in paths', () => {
        const tsConfigContent = `{
            // TypeScript configuration
            "compilerOptions": {
                "baseUrl": "./",
                /* Path mappings for module resolution */
                "paths": {
                    "@/vdb/*": ["./node_modules/@vendure/dashboard/src/lib/*"],
                    "@/components/*": ["src/components/*"]
                }
            }
        }`;

        // This should not throw an error when parsing
        const result = JSON.parse(stripJsonComments(tsConfigContent));
        expect(result.compilerOptions.paths['@/vdb/*']).toEqual([
            './node_modules/@vendure/dashboard/src/lib/*',
        ]);
        expect(result.compilerOptions.paths['@/components/*']).toEqual(['src/components/*']);
    });
});
