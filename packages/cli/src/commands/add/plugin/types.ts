export interface GeneratePluginOptions {
    name: string;
    pluginDir: string;
    config?: string;
}

export type NewPluginTemplateContext = GeneratePluginOptions & {
    pluginName: string;
    pluginInitOptionsName: string;
};
