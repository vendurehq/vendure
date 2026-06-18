import { ManipulationSettings, QuoteKind } from 'ts-morph';

export const defaultManipulationSettings: Partial<ManipulationSettings> = {
    quoteKind: QuoteKind.Single,
    useTrailingCommas: true,
};
export const pascalCaseRegex = /^[A-Z][a-zA-Z0-9]*$/;
export const AdminUiExtensionTypeName = 'AdminUiExtension';
export const AdminUiAppConfigName = 'AdminUiAppConfig';
export const Messages = {
    NoPluginsFound: `No plugins were found in this project. Create a plugin first by selecting "[Plugin] Create a new Vendure plugin"`,
    NoEntitiesFound: `No entities were found in this plugin.`,
    NoServicesFound: `No services were found in this plugin. Create a service first by selecting "[Plugin: Service] Add a new service to a plugin"`,
};
