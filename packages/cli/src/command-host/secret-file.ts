import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { writePrivateFile } from '../auth/auth-store.js';
import { getVendureCliConfigDir } from '../shared/cli-config-dir.js';

/**
 * Writes the secret output `field` of `command` to a new file in `secrets/` of the CLI
 * configuration directory, readable only by the user (mode 0600, directory 0700), and returns
 * its absolute path. Each call writes a new file, so a later run never replaces a secret the
 * caller has not read yet.
 */
export function writeSecretFile(
    command: string[],
    field: string,
    value: string,
    env?: NodeJS.ProcessEnv,
): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '');
    const name = `${[...command, field].join('-')}-${stamp}-${randomBytes(4).toString('hex')}`;
    const file = path.resolve(getVendureCliConfigDir(env), 'secrets', name);
    writePrivateFile(file, value);
    return file;
}
