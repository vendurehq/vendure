// A CLI plugin that takes 20 seconds to load in a process `vendure mcp` starts for it, standing in
// for one that does slow work while it loads. The `vendure mcp` process itself loads it at once.
if (process.env.VENDURE_CLI_MCP === '1') {
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
        // Block, as synchronous work at load does.
    }
}

module.exports = { id: '@vendure-e2e/slow-cli-plugin' };
