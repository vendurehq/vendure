import { Socket, createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findAvailablePort, isServerPortInUse } from './helpers';
import { log } from './logger';

// Replace the project's logger with a spy so we can assert on warning calls
// without coupling to its console-printing behaviour.
vi.mock('./logger', () => ({
    log: vi.fn(),
}));

/**
 * Binds an ephemeral port on 127.0.0.1 and returns both the server and its
 * port. The caller is responsible for closing the server (or relying on
 * `afterEach` cleanup).
 */
function listenOnEphemeralPort(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (typeof address === 'object' && address !== null) {
                resolve({ server, port: address.port });
            } else {
                reject(new Error('Could not determine ephemeral port'));
            }
        });
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
    });
}

describe('isServerPortInUse', () => {
    let openServers: Server[] = [];

    afterEach(async () => {
        for (const server of openServers) {
            await closeServer(server).catch(() => undefined);
        }
        openServers = [];
        vi.restoreAllMocks();
        vi.mocked(log).mockClear();
    });

    it('returns true when a server is listening on the port', async () => {
        const { server, port } = await listenOnEphemeralPort();
        openServers.push(server);

        await expect(isServerPortInUse(port)).resolves.toBe(true);
    });

    it('returns false when no server is listening on the port', async () => {
        // Reserve and release an ephemeral port so we know it's currently free.
        const { server, port } = await listenOnEphemeralPort();
        await closeServer(server);

        await expect(isServerPortInUse(port)).resolves.toBe(false);
    });

    it('returns false again once the server stops listening', async () => {
        const { server, port } = await listenOnEphemeralPort();
        openServers.push(server);
        await expect(isServerPortInUse(port)).resolves.toBe(true);

        await closeServer(server);
        openServers = [];
        await expect(isServerPortInUse(port)).resolves.toBe(false);
    });

    it.each([0, -1, 70000, 3.14, NaN, Number.POSITIVE_INFINITY])(
        'rejects with "Invalid port" for invalid input %s',
        async invalid => {
            await expect(isServerPortInUse(invalid)).rejects.toThrow(/Invalid port/);
        },
    );

    it('times out rather than hanging when the SYN is silently dropped', async () => {
        // Simulate a firewall that drops SYN packets: connect() neither resolves
        // nor emits ECONNREFUSED. Without a setTimeout guard the promise would
        // hang for the OS-level connect timeout (~75s macOS, ~127s Linux).
        const connectSpy = vi
            .spyOn(Socket.prototype, 'connect')
            .mockImplementation(function (this: Socket) {
                // Intentionally never emit anything — let the socket's own timeout fire.
                return this;
            });

        await expect(isServerPortInUse(12345)).rejects.toThrow(/Timed out/);
        expect(connectSpy).toHaveBeenCalledOnce();
    });

    it('rejects with the underlying error on non-ECONNREFUSED socket failures', async () => {
        // Intercept Socket.connect so the next call emits a synthetic
        // EHOSTUNREACH error instead of actually opening a connection. This
        // covers the production code path that surfaces "real" socket
        // failures (e.g. EACCES on privileged ports, EHOSTUNREACH on DNS
        // misconfiguration) without needing elevated privileges or DNS
        // tricks at test time.
        const connectSpy = vi
            .spyOn(Socket.prototype, 'connect')
            .mockImplementation(function (this: Socket) {
                queueMicrotask(() => {
                    const err = new Error('Host unreachable') as NodeJS.ErrnoException;
                    err.code = 'EHOSTUNREACH';
                    this.emit('error', err);
                });
                return this;
            });

        await expect(isServerPortInUse(12345)).rejects.toMatchObject({ code: 'EHOSTUNREACH' });
        expect(connectSpy).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('could not determine'));
    });
});

describe('findAvailablePort', () => {
    let openServers: Server[] = [];

    afterEach(async () => {
        for (const server of openServers) {
            await closeServer(server).catch(() => undefined);
        }
        openServers = [];
        vi.restoreAllMocks();
    });

    it('returns the first available port when the start port is free', async () => {
        const { server, port } = await listenOnEphemeralPort();
        await closeServer(server);

        await expect(findAvailablePort(port, 5)).resolves.toBe(port);
    });

    it('skips occupied ports until it finds a free one', async () => {
        const { server: busy, port: busyPort } = await listenOnEphemeralPort();
        openServers.push(busy);

        const next = await findAvailablePort(busyPort, 100);
        expect(next).toBeGreaterThan(busyPort);
    });

    it('surfaces probe failures with a useful message rather than masking them', async () => {
        // Make every probe reject with EACCES so the loop can't paper over it.
        vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
            queueMicrotask(() => {
                const err = new Error('Permission denied') as NodeJS.ErrnoException;
                err.code = 'EACCES';
                this.emit('error', err);
            });
            return this;
        });

        await expect(findAvailablePort(3000, 1)).rejects.toThrow(/Could not probe port/);
    });
});
