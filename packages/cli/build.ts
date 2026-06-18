import fs from 'fs-extra';
import path from 'path';

// This build script copies all .template.ts files from the "src" directory to the "dist" directory.
// This is necessary because the .template.ts files are used to generate the actual source files.
const templateFiles = findFilesWithSuffix(path.join(__dirname, 'src'), ['.template.ts', '.template.tsx']);
for (const file of templateFiles) {
    // copy to the equivalent path in the "dist" rather than "src" directory
    const relativePath = path.relative(path.join(__dirname, 'src'), file);
    const distPath = path.join(__dirname, 'dist', relativePath);
    fs.ensureDirSync(path.dirname(distPath));
    fs.copyFileSync(file, distPath);
}

function findFilesWithSuffix(directory: string, suffix: string | string[]): string[] {
    const files: string[] = [];
    const suffixes = Array.isArray(suffix) ? suffix : [suffix];

    function traverseDirectory(dir: string) {
        const dirContents = fs.readdirSync(dir);

        dirContents.forEach(item => {
            const itemPath = path.join(dir, item);
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                traverseDirectory(itemPath);
            } else if (suffixes.some(s => item.endsWith(s))) {
                files.push(itemPath);
            }
        });
    }

    traverseDirectory(directory);

    return files;
}
