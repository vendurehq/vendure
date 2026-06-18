import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_DIRS = ['components', 'framework', 'hooks', 'lib', 'graphql'];
const LIB_DIR = path.join(__dirname, '..', 'src', 'lib');
const INDEX_FILE = path.join(LIB_DIR, 'index.ts');

function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            getAllFiles(filePath, fileList);
        } else if (
            file.match(/\.(ts|tsx|js|jsx)$/) &&
            !file.startsWith('index.') && // Exclude index files
            !file.endsWith('.d.ts') &&
            !file.endsWith('.spec.ts') &&
            !file.endsWith('.spec.tsx') &&
            !file.endsWith('.stories.tsx') &&
            !file.endsWith('.stories.ts')
        ) {
            fileList.push(filePath);
        }
    });

    return fileList;
}

function generateExports() {
    let exportStatements = [];

    TARGET_DIRS.forEach(dir => {
        const dirPath = path.join(LIB_DIR, dir);
        if (!fs.existsSync(dirPath)) {
            console.warn(`Directory ${dirPath} does not exist`);
            return;
        }

        const files = getAllFiles(dirPath);
        files.forEach(file => {
            const relativePath = path.relative(LIB_DIR, file);
            const exportPath = relativePath.replace(/\\/g, '/');
            // replace the tsx with js in the export path
            const exportPathJs = exportPath.replace(/\.tsx?/, '.js');

            // Generate both named and default exports
            exportStatements.push(`export * from './${exportPathJs}';`);
        });
    });

    return exportStatements.join('\n');
}

function generateIndexFile() {
    const exports = generateExports();
    const content = `// This file is auto-generated. Do not edit manually.

${exports}
`;

    fs.writeFileSync(INDEX_FILE, content);
    console.log(`Generated ${INDEX_FILE} successfully!`);
}

generateIndexFile();
