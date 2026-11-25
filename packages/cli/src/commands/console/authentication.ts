import { ChildProcess, spawn } from 'node:child_process';

/** Opens a URL in the system browser, for the device login of `vendure auth` and `vendure console`. */
export function openConsoleBrowser(url: string): Promise<void> {
    const windows = process.platform === 'win32';
    let command = 'xdg-open';
    if (windows) {
        command = 'rundll32';
    } else if (process.platform === 'darwin') {
        command = 'open';
    }
    const args = windows ? ['url.dll,FileProtocolHandler', url] : [url];
    return new Promise((resolve, reject) => {
        let child: ChildProcess;
        try {
            child = spawn(command, args, { detached: true, stdio: 'ignore' });
        } catch (error) {
            reject(error);
            return;
        }
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}
