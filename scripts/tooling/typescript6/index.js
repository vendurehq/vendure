// Re-exports the TypeScript 6 JS API. This private workspace package depends on typescript@6, while
// the repo root depends on typescript@7. Because the names clash, the package manager cannot hoist
// TypeScript 6 to the root node_modules: it is installed in this package's own node_modules, so its
// `tsc` bin can never shadow TypeScript 7's `tsc` in the root node_modules/.bin.
module.exports = require('typescript');
