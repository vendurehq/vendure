import { describe, expect, it } from 'vitest';

import { createSpawn } from './spawn.js';

describe('createSpawn', () => {
    it('forwards the process stdout to the given writer and returns the result', async () => {
        const forwarded: string[] = [];
        const spawn = createSpawn(process.cwd(), new AbortController().signal, text => forwarded.push(text));
        const result = await spawn(process.execPath, ['-e', 'process.stdout.write("out"); process.exit(3)']);
        expect(forwarded.join('')).toBe('out');
        expect(result).toMatchObject({ exitCode: 3, stdout: 'out' });
    });

    it('passes on whole lines only when asked, and ends the last one with a newline', async () => {
        const forwarded: string[] = [];
        const spawn = createSpawn(process.cwd(), new AbortController().signal, text => forwarded.push(text), {
            wholeLines: true,
        });
        await spawn(process.execPath, [
            '-e',
            'process.stdout.write("a"); setTimeout(() => { process.stdout.write("b\\nc"); }, 50)',
        ]);
        expect(forwarded).toEqual(['ab\n', 'c\n']);
    });

    it('stops the process when the signal fires', async () => {
        const controller = new AbortController();
        const spawn = createSpawn(process.cwd(), controller.signal, () => undefined);
        const running = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
        setTimeout(() => controller.abort(), 100);
        const result = await running;
        expect(result.exitCode).not.toBe(0);
    });
});
