import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The MCP SDK v2 packages are ESM-first and ship a dual CJS build. @vendure/mcp-plugin
// compiles to CommonJS, so at runtime it reaches these packages via `require`. This smoke
// test locks in Node's `require(esm)` interop on every repo-supported Node version — if a
// future SDK bump drops the CJS entry, the plugin would fail to load and this test catches it.
// Anchor the CJS resolver at the package root (avoids `import.meta`, which tsc rejects for CJS output).
const require = createRequire(path.join(process.cwd(), 'noop.js'));

describe('MCP SDK CJS→ESM interop', () => {
    it('require("@modelcontextprotocol/server") exposes the v2 surface the transport needs', () => {
        const server = require('@modelcontextprotocol/server');
        expect(typeof server.McpServer).toBe('function');
        expect(typeof server.createMcpHandler).toBe('function');
        expect(typeof server.fromJsonSchema).toBe('function');
    });

    it('require("@modelcontextprotocol/node") exposes the Node bridge + DNS-rebind guards', () => {
        const node = require('@modelcontextprotocol/node');
        expect(typeof node.toNodeHandler).toBe('function');
        expect(typeof node.hostHeaderValidation).toBe('function');
        expect(typeof node.originValidation).toBe('function');
    });
});
