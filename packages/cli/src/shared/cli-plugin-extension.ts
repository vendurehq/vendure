export interface RegisteredCliPluginExtension<T = unknown> {
    pluginId: string;
    extension: T;
}

export type CliPluginExtensionAccessor = <T = unknown>(
    extensionPoint: string,
) => ReadonlyArray<RegisteredCliPluginExtension<T>>;
