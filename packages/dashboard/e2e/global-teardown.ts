export default async function globalTeardown() {
    const server = (globalThis as any).__VENDURE_SERVER__;
    if (server) {
        await server.destroy();
    }
}
