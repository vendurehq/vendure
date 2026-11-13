import fs from 'fs-extra';
import path from 'path';

import { initialData } from '../core/mock-data/data-sources/initial-data';

const dataDir = path.join(__dirname, '../core/mock-data');

function copyTemplates() {
    return fs.copy('./templates', './assets');
}

function copyImages() {
    return fs.copy(path.join(dataDir, 'assets'), './assets/images');
}

function copyProductData() {
    return fs.copy(path.join(dataDir, 'data-sources/products.csv'), './assets/products.csv');
}

function copyCliInitialData() {
    return fs.outputFile('./assets/initial-data.json', JSON.stringify(initialData, null, 2), 'utf-8');
}

copyTemplates()
    .then(copyImages)
    .then(copyProductData)
    .then(copyCliInitialData)
    .then(() => process.exit(0))
    .catch(err => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    });
