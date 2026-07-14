#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Normalize paths to ensure cross-platform compatibility
const normalizePath = p => path.normalize(p);

// Check if we're running from the dashboard directory or root directory
const currentDir = normalizePath(process.cwd());
const isDashboardDir = currentDir.endsWith(normalizePath('packages/dashboard'));
const HOOKS_DIR = isDashboardDir
    ? normalizePath(path.join(__dirname, '../src/lib/hooks'))
    : normalizePath(path.join(currentDir, 'packages/dashboard/src/lib/hooks'));
const DASHBOARD_SRC_DIR = isDashboardDir
    ? normalizePath(path.join(__dirname, '../src'))
    : normalizePath(path.join(currentDir, 'packages/dashboard/src'));

// Required prefix for imports in hook files
const REQUIRED_PREFIX = '@/vdb';
// Banned import pattern
const BANNED_IMPORT = '@/vdb/index.js';
// Lib directory (auto-exported via index.ts)
const LIB_DIR = isDashboardDir
    ? normalizePath(path.join(__dirname, '../src/lib'))
    : normalizePath(path.join(currentDir, 'packages/dashboard/src/lib'));

// Files allowed to have createContext + useContext in the same file.
// These are UI primitives (e.g., shadcn components) where the context is internal
// and not intended to be accessed by extensions.
const CONTEXT_PATTERN_ALLOWLIST = [
    'components/ui/carousel.tsx',
    'components/ui/chart.tsx',
    'components/ui/toggle-group.tsx',
];

function findHookFiles(dir) {
    const files = [];

    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = normalizePath(path.join(dir, item));
        const stat = fs.statSync(fullPath);

        if (stat.isFile() && item.startsWith('use-') && (item.endsWith('.ts') || item.endsWith('.tsx'))) {
            files.push(fullPath);
        }
    }

    return files;
}

function findDashboardFiles(dir) {
    const files = [];

    function scanDirectory(currentDir) {
        const items = fs.readdirSync(currentDir);

        for (const item of items) {
            const fullPath = normalizePath(path.join(currentDir, item));
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                if (!['node_modules', '.git', 'dist', 'build', '.next'].includes(item)) {
                    scanDirectory(fullPath);
                }
            } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.tsx'))) {
                files.push(fullPath);
            }
        }
    }

    scanDirectory(dir);
    return files;
}

function checkFileForBadImports(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const badImports = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('import')) {
            if (trimmedLine.includes('../')) {
                badImports.push({
                    line: i + 1,
                    content: trimmedLine,
                    reason: 'Relative imports going up directories (../) are not allowed in hook files',
                });
            }

            if (trimmedLine.includes('@/') && !trimmedLine.includes(REQUIRED_PREFIX)) {
                badImports.push({
                    line: i + 1,
                    content: trimmedLine,
                    reason: `Import must start with ${REQUIRED_PREFIX}`,
                });
            }
        }
    }

    return badImports;
}

function checkFileForBannedImports(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const badImports = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('import') && trimmedLine.includes(BANNED_IMPORT)) {
            badImports.push({
                line: i + 1,
                content: trimmedLine,
                reason: `Import from '${BANNED_IMPORT}' is not allowed anywhere in the dashboard app`,
            });
        }
    }

    return badImports;
}

/**
 * Check for React Context module identity issues.
 *
 * Files in src/lib/ are auto-exported via index.ts. If a file defines a React Context
 * AND also consumes it (via useContext), this causes module identity issues when
 * extensions dynamically import from @vendure/dashboard - the context object in the
 * extension's bundle will be different from the one in the main app's bundle.
 *
 * The fix is to split context definition and consumption into separate files:
 * - Context definition in a dedicated file (e.g., paginated-list-context.ts)
 * - Hook that consumes the context in src/lib/hooks/ (e.g., use-paginated-list.ts)
 */
function checkFileForContextPattern(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const issues = [];

    // Check if file is in src/lib/ (auto-exported)
    if (!filePath.includes(normalizePath('src/lib/'))) {
        return issues;
    }

    // Check if file is in the allowlist
    for (const allowedFile of CONTEXT_PATTERN_ALLOWLIST) {
        if (filePath.includes(normalizePath(allowedFile))) {
            return issues;
        }
    }

    const hasCreateContext = /createContext\s*[<(]/.test(content);
    const hasUseContext = /useContext\s*\(/.test(content);

    if (hasCreateContext && hasUseContext) {
        // Find line numbers for better error reporting
        const lines = content.split('\n');
        let createContextLine = 0;
        let useContextLine = 0;

        for (let i = 0; i < lines.length; i++) {
            if (/createContext\s*[<(]/.test(lines[i]) && createContextLine === 0) {
                createContextLine = i + 1;
            }
            if (/useContext\s*\(/.test(lines[i]) && useContextLine === 0) {
                useContextLine = i + 1;
            }
        }

        issues.push({
            createContextLine,
            useContextLine,
            reason:
                'File defines a React Context (createContext) and also consumes it (useContext). ' +
                'This causes module identity issues when extensions dynamically import from @vendure/dashboard. ' +
                'Split into separate files: context definition in a dedicated file, hook in src/lib/hooks/',
        });
    }

    return issues;
}

function findLibFiles(dir) {
    const files = [];

    function scanDirectory(currentDir) {
        const items = fs.readdirSync(currentDir);

        for (const item of items) {
            const fullPath = normalizePath(path.join(currentDir, item));
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                if (!['node_modules', '.git', 'dist', 'build'].includes(item)) {
                    scanDirectory(fullPath);
                }
            } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.tsx'))) {
                // Skip test and story files
                if (!item.endsWith('.spec.ts') && !item.endsWith('.stories.tsx')) {
                    files.push(fullPath);
                }
            }
        }
    }

    scanDirectory(dir);
    return files;
}

function main() {
    console.log('🔍 Checking for import patterns in the dashboard app...\n');

    console.log('📁 Checking hook files (use-*.ts/tsx) in src/lib/hooks directory...');
    console.log('✅ Hook file requirements:');
    console.log(`   - All imports must start with ${REQUIRED_PREFIX}`);
    console.log('   - Relative imports going up directories (../) are not allowed');
    console.log('   - Relative imports in same directory (./) are allowed');
    console.log('');

    if (!fs.existsSync(HOOKS_DIR)) {
        console.error('❌ src/lib/hooks directory not found!');
        process.exit(1);
    }

    const hookFiles = findHookFiles(HOOKS_DIR);
    let hasBadImports = false;
    let totalBadImports = 0;

    for (const file of hookFiles) {
        const relativePath = normalizePath(path.relative(process.cwd(), file));
        const badImports = checkFileForBadImports(file);

        if (badImports.length > 0) {
            hasBadImports = true;
            totalBadImports += badImports.length;

            console.log(`❌ ${relativePath}:`);
            for (const badImport of badImports) {
                console.log(`   Line ${badImport.line}: ${badImport.content}`);
                console.log(`      Reason: ${badImport.reason}`);
            }
            console.log('');
        }
    }

    if (hasBadImports) {
        console.log(`❌ Found ${totalBadImports} bad import(s) in ${hookFiles.length} hook file(s)`);
        console.log(
            `💡 All imports in hook files must start with ${REQUIRED_PREFIX} and must not use relative paths going up directories`,
        );
    } else {
        console.log(`✅ No bad imports found in ${hookFiles.length} hook file(s)`);
        console.log(`🎉 All imports in hook files are using ${REQUIRED_PREFIX} prefix`);
    }

    console.log('\n📁 Checking all dashboard files for banned imports...');
    console.log('✅ Dashboard-wide requirements:');
    console.log(`   - Import from '${BANNED_IMPORT}' is not allowed anywhere`);
    console.log('');

    if (!fs.existsSync(DASHBOARD_SRC_DIR)) {
        console.error('❌ src directory not found!');
        process.exit(1);
    }

    const dashboardFiles = findDashboardFiles(DASHBOARD_SRC_DIR);
    let hasBannedImports = false;
    let totalBannedImports = 0;

    for (const file of dashboardFiles) {
        const relativePath = normalizePath(path.relative(process.cwd(), file));
        const bannedImports = checkFileForBannedImports(file);

        if (bannedImports.length > 0) {
            hasBannedImports = true;
            totalBannedImports += bannedImports.length;

            console.log(`❌ ${relativePath}:`);
            for (const bannedImport of bannedImports) {
                console.log(`   Line ${bannedImport.line}: ${bannedImport.content}`);
                console.log(`      Reason: ${bannedImport.reason}`);
            }
            console.log('');
        }
    }

    if (hasBannedImports) {
        console.log(
            `❌ Found ${totalBannedImports} banned import(s) in ${dashboardFiles.length} dashboard file(s)`,
        );
        console.log(`💡 Import from '${BANNED_IMPORT}' is not allowed anywhere in the dashboard app`);
    } else {
        console.log(`✅ No banned imports found in ${dashboardFiles.length} dashboard file(s)`);
        console.log(`🎉 All dashboard files are free of banned imports`);
    }

    // Check for React Context module identity issues in lib files
    console.log('\n📁 Checking src/lib files for React Context patterns...');
    console.log('✅ Context pattern requirements:');
    console.log('   - Files must NOT both define (createContext) and consume (useContext) a React Context');
    console.log('   - Split context definition and hooks into separate files to prevent module identity issues');
    console.log('');

    if (!fs.existsSync(LIB_DIR)) {
        console.error('❌ src/lib directory not found!');
        process.exit(1);
    }

    const libFiles = findLibFiles(LIB_DIR);
    let hasContextIssues = false;
    let totalContextIssues = 0;

    for (const file of libFiles) {
        const relativePath = normalizePath(path.relative(process.cwd(), file));
        const contextIssues = checkFileForContextPattern(file);

        if (contextIssues.length > 0) {
            hasContextIssues = true;
            totalContextIssues += contextIssues.length;

            console.log(`❌ ${relativePath}:`);
            for (const issue of contextIssues) {
                console.log(`   createContext at line ${issue.createContextLine}, useContext at line ${issue.useContextLine}`);
                console.log(`   Reason: ${issue.reason}`);
            }
            console.log('');
        }
    }

    if (hasContextIssues) {
        console.log(`❌ Found ${totalContextIssues} context pattern issue(s) in ${libFiles.length} lib file(s)`);
        console.log('💡 Move context definitions to dedicated files and hooks to src/lib/hooks/');
    } else {
        console.log(`✅ No context pattern issues found in ${libFiles.length} lib file(s)`);
        console.log('🎉 All lib files follow the correct context pattern');
    }

    if (hasBadImports || hasBannedImports || hasContextIssues) {
        process.exit(1);
    }
}

main();
