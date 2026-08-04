import * as http from 'http';
import { AddressInfo } from 'net';

// Loopback HTTP server that plays the role of a CIMD client's website: it hosts client
// metadata documents for the authorization server to fetch. Plain HTTP on 127.0.0.1 is
// accepted by the server under test because e2e runs with NODE_ENV !== 'production'
// (the draft's development loopback exception).

export interface CimdTestServer {
    /** Base URL of the server, e.g. `http://127.0.0.1:54321`. */
    baseUrl: string;
    /** Sets the response served for `path`. Objects are JSON-stringified. */
    setDocument(path: string, body: unknown, headers?: Record<string, string>): void;
    /** Serves an HTTP error status for `path`. */
    setError(path: string, statusCode: number): void;
    /** Number of requests received for `path` so far. */
    requestCount(path: string): number;
    close(): Promise<void>;
}

export async function startCimdTestServer(): Promise<CimdTestServer> {
    const documents = new Map<string, { body: string; headers: Record<string, string> }>();
    const errors = new Map<string, number>();
    const counts = new Map<string, number>();
    const server = http.createServer((req, res) => {
        const path = (req.url ?? '').split('?')[0];
        counts.set(path, (counts.get(path) ?? 0) + 1);
        const errorStatus = errors.get(path);
        if (errorStatus) {
            res.statusCode = errorStatus;
            return res.end('error');
        }
        const document = documents.get(path);
        if (!document) {
            res.statusCode = 404;
            return res.end('not found');
        }
        res.setHeader('content-type', 'application/json');
        for (const [name, value] of Object.entries(document.headers)) {
            res.setHeader(name, value);
        }
        res.end(document.body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        setDocument: (path, body, headers = {}) => {
            errors.delete(path);
            documents.set(path, {
                body: typeof body === 'string' ? body : JSON.stringify(body),
                headers,
            });
        },
        setError: (path, statusCode) => {
            documents.delete(path);
            errors.set(path, statusCode);
        },
        requestCount: path => counts.get(path) ?? 0,
        close: () =>
            new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
    };
}
