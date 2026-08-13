import { describe, expect, it } from 'vitest';

import { revertMigrationCommand } from './revert-migration';

describe('revertMigrationCommand', () => {
    it('uses revert-specific metadata', () => {
        expect(revertMigrationCommand.id).toBe('revert-migration');
        expect(revertMigrationCommand.description).toBe('Revert the last applied database migration');
    });
});
