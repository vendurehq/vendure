import { CliPluginExtensionAccessor, RegisteredCliPluginExtension } from './cli-plugin-extension.js';

let accessor: CliPluginExtensionAccessor | undefined;

/**
 * Makes the extensions of the loaded CLI plugins available to the commands declared with
 * `defineCommand`, such as the `afterConsoleLink` hooks that `vendure console link` runs. The CLI
 * calls it once the plugins are registered.
 */
export function setPluginExtensionAccessor(next: CliPluginExtensionAccessor | undefined): void {
    accessor = next;
}

/** The extensions the loaded CLI plugins registered for `extensionPoint`. Empty before plugins load. */
export function getPluginExtensions<T = unknown>(
    extensionPoint: string,
): ReadonlyArray<RegisteredCliPluginExtension<T>> {
    return accessor ? accessor<T>(extensionPoint) : [];
}

let pluginProjectRoot: string | undefined;

/** Records the project whose CLI plugins the CLI loaded. The CLI calls it as it loads them. */
export function setPluginProjectRoot(projectRoot: string | undefined): void {
    pluginProjectRoot = projectRoot;
}

/** The project whose CLI plugins the CLI loaded. Undefined outside the CLI, or before plugins load. */
export function getPluginProjectRoot(): string | undefined {
    return pluginProjectRoot;
}
