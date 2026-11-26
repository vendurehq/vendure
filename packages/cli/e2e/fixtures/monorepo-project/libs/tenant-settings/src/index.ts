import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface TenantSettings {
    port: number;
    databaseFile: string;
}

/** Reads the settings of one tenant, which only exist once the server runs. */
export async function loadTenantSettings(tenant: string): Promise<TenantSettings> {
    const file = path.join(__dirname, '../tenants', `${tenant}.json`);
    return JSON.parse(await fs.readFile(file, 'utf-8')) as TenantSettings;
}
