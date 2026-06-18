const path = require('node:path');
const fs = require('node:fs');
const sass = require('sass');

// Compiles the Admin UI styles into a css file for consumption by
// non-Angular ui extensions.
const outFile = path.join(__dirname, '../package/static/theme.min.css');
const result = sass.renderSync({
    file: path.join(__dirname, '../src/lib/static/styles/ui-extension-theme.scss'),
    importer,
    includePaths: [
        path.join(__dirname, '../src/lib/static/styles'),
        path.join(__dirname, '../src/lib/static/fonts'),
        path.join(__dirname, '../node_modules'),
        path.join(__dirname, '../../../node_modules'),
    ],
    outputStyle: 'compressed',
    outFile,
});

fs.writeFileSync(outFile, result.css, 'utf8');

function importer(url, prev) {
    let file = url;
    // Handle the imports prefixed with
    // which are usually resolved by Webpack.
    if (/^~@clr/.test(url)) {
        const sansTilde = url.substr(1);
        const fullPath = path.extname(sansTilde) === '' ? sansTilde + '.scss' : sansTilde;
        file = require.resolve(fullPath);
    }

    // Ignore the contents of the Angular-specific
    // library styles which are not needed in external
    // apps.
    if (/^~@(ng-select|angular)/.test(url)) {
        return null;
    }

    return { file };
}
