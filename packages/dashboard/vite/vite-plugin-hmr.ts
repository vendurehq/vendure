import { ModuleNode, Plugin } from 'vite';

/**
 * @description
 * This plugin enables kind-of HMR for when dashboard extension files change.
 * It is not true HMR because it triggers a page reload. Making real HMR work is very
 * tricky in this case due to the way we load extension files via virtual modules.
 */
export function hmrPlugin(): Plugin {
    let viteRoot: string;

    return {
        name: 'vendure:hmr',
        configResolved(config) {
            viteRoot = config.root;
        },
        handleHotUpdate({ server, modules, timestamp, file }) {
            const invalidatedModules = new Set<ModuleNode>();

            for (const mod of modules) {
                server.moduleGraph.invalidateModule(mod, invalidatedModules, timestamp, true);

                // Check if this is a file outside the Vite root (e.g., dashboard extensions)
                const isOutsideRoot = mod.file && !mod.file.startsWith(viteRoot);

                if (isOutsideRoot) {
                    // For files outside root, trigger a full page reload
                    // This ensures all extension code is fresh
                    server.hot.send({
                        type: 'full-reload',
                        path: '*',
                    });

                    return [];
                }
            }

            // Let Vite handle normal HMR for files inside root
            return undefined;
        },
    };
}
