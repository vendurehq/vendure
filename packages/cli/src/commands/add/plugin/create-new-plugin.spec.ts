import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cancel symbol to simulate user pressing Ctrl+C / Escape in prompts
const CANCEL_SYMBOL = Symbol('clack:cancel');

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn((value: unknown) => value === CANCEL_SYMBOL),
    select: vi.fn(),
    text: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    log: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Mock shared prompts
vi.mock('../../../shared/shared-prompts', () => ({
    analyzeProject: vi.fn(),
    selectPlugin: vi.fn(),
}));

// Mock VendureConfigRef
vi.mock('../../../shared/vendure-config-ref', () => ({
    VendureConfigRef: vi.fn(),
}));

// Mock ast-utils
vi.mock('../../../utilities/ast-utils', () => ({
    createFile: vi.fn(),
    getPluginClasses: vi.fn(() => []),
    addImportsToFile: vi.fn(),
}));

// Mock utils
vi.mock('../../../utilities/utils', () => ({
    pauseForPromptDisplay: vi.fn().mockResolvedValue(undefined),
    withInteractiveTimeout: vi.fn((fn: () => Promise<any>) => fn()),
    isRunningInTsNode: vi.fn(() => false),
}));

// Mock fs-extra
vi.mock('fs-extra', () => ({
    existsSync: vi.fn(() => false),
    default: { existsSync: vi.fn(() => false) },
}));

import { select, text } from '@clack/prompts';

import { analyzeProject } from '../../../shared/shared-prompts';
import { VendureConfigRef } from '../../../shared/vendure-config-ref';
import { createFile } from '../../../utilities/ast-utils';

import { createNewPlugin } from './create-new-plugin';

function setupMocks() {
    // Re-apply VendureConfigRef mock each time (vi.restoreAllMocks clears it)
    vi.mocked(VendureConfigRef).mockImplementation((() => ({
        addToPluginsArray: vi.fn(),
        sourceFile: {
            getProject: vi.fn(() => ({ save: vi.fn().mockResolvedValue(undefined) })),
        },
    })) as any);

    const mockPluginClass = {
        rename: vi.fn(),
        getName: vi.fn(() => 'TestFeaturePlugin'),
        getSourceFile: vi.fn(() => ({})),
    };

    const mockImportDecl = { setModuleSpecifier: vi.fn() };
    const mockVarDecl = { rename: vi.fn().mockReturnThis(), set: vi.fn() };

    const mockPluginFile = {
        getClass: vi.fn((name: string) => (name === 'TemplatePlugin' ? mockPluginClass : undefined)),
        getImportDeclaration: vi.fn(() => mockImportDecl),
        organizeImports: vi.fn(),
    };
    const mockTypesFile = {
        getClass: vi.fn(() => undefined),
        organizeImports: vi.fn(),
    };
    const mockConstantsFile = {
        getClass: vi.fn(() => undefined),
        getVariableDeclaration: vi.fn(() => mockVarDecl),
        organizeImports: vi.fn(),
    };

    vi.mocked(analyzeProject).mockResolvedValue({
        project: { save: vi.fn().mockResolvedValue(undefined) } as any,
        config: undefined,
        vendureTsConfig: '/tmp/tsconfig.json',
    } as any);

    vi.mocked(createFile)
        .mockReturnValueOnce(mockPluginFile as any)
        .mockReturnValueOnce(mockTypesFile as any)
        .mockReturnValueOnce(mockConstantsFile as any);

    // text is called twice in interactive mode: plugin name, then plugin location
    vi.mocked(text).mockResolvedValueOnce('test-feature').mockResolvedValueOnce('/tmp/plugins/test-feature');
}

describe('createNewPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('follow-up feature selection', () => {
        it('should not throw when cancelling the follow-up feature selection', async () => {
            setupMocks();
            // Simulate user pressing Ctrl+C/Escape during "Add features to plugin?" prompt
            vi.mocked(select).mockResolvedValueOnce(CANCEL_SYMBOL);

            // With the bug, this throws:
            // "TypeError: Cannot read properties of undefined (reading 'id')"
            // because the cancel check doesn't prevent falling through to the else branch
            const result = await createNewPlugin();

            expect(result).toBeDefined();
            expect(result.project).toBeDefined();
            expect(result.modifiedSourceFiles).toBeDefined();
        });

        it('should exit cleanly when user selects "no" (finish)', async () => {
            setupMocks();
            vi.mocked(select).mockResolvedValueOnce('no');

            const result = await createNewPlugin();

            expect(result).toBeDefined();
            expect(result.project).toBeDefined();
        });
    });
});
