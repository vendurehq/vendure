import { describe, expect, it } from 'vitest';

import { projectDirArgs, selectsPluginProject } from './project-dir-flag.js';

describe('projectDirArgs', () => {
    it('passes the dir of a command that loads the plugins of its project', () => {
        expect(projectDirArgs(['console', 'link'], { dir: 'apps/server' })).toEqual(['--dir', 'apps/server']);
        expect(projectDirArgs(['console', 'status'], { dir: 'apps/server' })).toEqual([
            '--dir',
            'apps/server',
        ]);
        expect(projectDirArgs(['dev'], { dir: 'apps/server' })).toEqual(['--dir', 'apps/server']);
    });

    it('passes nothing without a dir, or for a command that loads the plugins of the working directory', () => {
        expect(projectDirArgs(['console', 'link'], {})).toEqual([]);
        expect(projectDirArgs(['console', 'link'], { dir: ' ' })).toEqual([]);
        expect(projectDirArgs(['doctor'], { dir: 'apps/server' })).toEqual([]);
        expect(selectsPluginProject(['migrate', 'generate'])).toBe(false);
    });
});
