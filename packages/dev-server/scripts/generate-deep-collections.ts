import { CollectionDefinition, InitialData } from '@vendure/core';
import fs from 'fs';
import path from 'path';

/**
 * This script generates lots of Collections, nested 3 levels deep. It is useful for testing
 * scenarios where we need to work with a large amount of Collections.
 */
const collections: CollectionDefinition[] = [];

for (let i = 1; i <= 20; i++) {
    const IName = `Collection ${i}`;
    collections.push({
        name: IName,
        filters: [],
    });
    for (let j = 1; j <= 5; j++) {
        const JName = `Collection ${i}-${j}`;
        collections.push({
            name: JName,
            filters: [],
            parentName: IName,
        });
        for (let k = 1; k <= 3; k++) {
            const KName = `Collection ${i}-${j}-${k}`;
            collections.push({
                name: KName,
                filters: [],
                parentName: JName,
            });
        }
    }
}

fs.writeFileSync(path.join(__dirname, 'collections.json'), JSON.stringify(collections, null, 2), 'utf-8');
