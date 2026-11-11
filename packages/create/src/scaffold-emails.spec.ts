import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { scaffoldEmails } from './helpers';

const emailPackage = path.join(__dirname, '../../email');

function tmpServerRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'create-emails-'));
    fs.writeJsonSync(path.join(root, 'package.json'), { name: 'test-server' });
    return root;
}

describe('scaffoldEmails()', () => {
    it.skipIf(!fs.existsSync(path.join(emailPackage, 'lib/cli/index.js')))(
        'copies every default email into src/email and lists them in src/email/index.ts',
        async () => {
            const root = tmpServerRoot();
            fs.ensureDirSync(path.join(root, 'node_modules/@vendure'));
            fs.symlinkSync(emailPackage, path.join(root, 'node_modules/@vendure/email'));

            const result = await scaffoldEmails(root);

            expect(result).toEqual({ ejected: true });
            const index = fs.readFileSync(path.join(root, 'src/email/index.ts'), 'utf-8');
            expect(index).toContain("import { orderShippedEmail } from './order-shipped/definition';");
            expect(index).toContain('export const emails: Array<EmailDefinition<any, any>> = [');
            for (const type of ['order-confirmation', 'payment-failed', 'password-reset']) {
                expect(fs.existsSync(path.join(root, 'src/email', type, 'template.tsx'))).toBe(true);
                expect(fs.existsSync(path.join(root, 'src/email', type, 'definition.ts'))).toBe(true);
            }
        },
    );

    it('falls back to the package defaults when @vendure/email is not installed', async () => {
        const root = tmpServerRoot();

        const result = await scaffoldEmails(root);

        expect(result.ejected).toBe(false);
        expect(fs.readFileSync(path.join(root, 'src/email/index.ts'), 'utf-8')).toContain(
            "export { defaultEmails as emails } from '@vendure/email';",
        );
    });
});
