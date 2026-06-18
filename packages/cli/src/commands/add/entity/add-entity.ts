import { cancel, isCancel, multiselect, spinner, text } from '@clack/prompts';
import { paramCase, pascalCase } from 'change-case';
import path from 'path';
import { ClassDeclaration, SourceFile } from 'ts-morph';

import { pascalCaseRegex } from '../../../constants';
import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { EntityRef } from '../../../shared/entity-ref';
import { analyzeProject, selectPlugin } from '../../../shared/shared-prompts';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref';
import { createFile, getPluginClasses } from '../../../utilities/ast-utils';
import { pauseForPromptDisplay, withInteractiveTimeout } from '../../../utilities/utils';

import { addEntityToPlugin } from './codemods/add-entity-to-plugin/add-entity-to-plugin';

const cancelledMessage = 'Add entity cancelled';

export interface AddEntityOptions {
    plugin?: VendurePluginRef;
    className: string;
    fileName: string;
    translationFileName: string;
    features: {
        customFields: boolean;
        translatable: boolean;
    };
    config?: string;
    isNonInteractive?: boolean;
    pluginName?: string;
    customFields?: boolean;
    translatable?: boolean;
}

export const addEntityCommand = new CliCommand({
    id: 'add-entity',
    category: 'Plugin: Entity',
    description: 'Add a new entity to a plugin',
    run: options => addEntity(options),
});

export async function addEntity(
    options?: Partial<AddEntityOptions>,
): Promise<CliCommandReturnVal<{ entityRef: EntityRef }>> {
    const providedVendurePlugin = options?.plugin;
    const { project } = await analyzeProject({
        providedVendurePlugin,
        cancelledMessage,
        config: options?.config,
    });

    let vendurePlugin = providedVendurePlugin;

    // If pluginName is provided (from CLI), find the plugin by name
    if (options?.pluginName && !vendurePlugin) {
        const pluginClasses = getPluginClasses(project);
        const pluginClass = pluginClasses.find((p: ClassDeclaration) => p.getName() === options.pluginName);
        if (!pluginClass) {
            const availablePlugins = pluginClasses.map((p: ClassDeclaration) => p.getName()).join(', ');
            throw new Error(
                `Plugin "${options.pluginName}" not found. Available plugins: ${availablePlugins}`,
            );
        }
        vendurePlugin = new VendurePluginRef(pluginClass);
    }

    // In non-interactive mode with no plugin specified after checking for pluginName, we cannot proceed
    if (options?.isNonInteractive && !vendurePlugin) {
        throw new Error(
            'Plugin must be specified when running in non-interactive mode. Usage: vendure add -e <entity-name> --selected-plugin <plugin-name>',
        );
    }

    vendurePlugin = vendurePlugin ?? (await selectPlugin(project, cancelledMessage));
    const modifiedSourceFiles: SourceFile[] = [];

    const customEntityName = options?.className ?? (await getCustomEntityName(cancelledMessage));

    const context: AddEntityOptions = {
        className: customEntityName,
        fileName: paramCase(customEntityName) + '.entity',
        translationFileName: paramCase(customEntityName) + '-translation.entity',
        features: await getFeatures(options),
        config: options?.config,
    };

    const entitySpinner = spinner();
    entitySpinner.start('Creating entity...');
    await pauseForPromptDisplay();

    const { entityClass, translationClass } = createEntity(vendurePlugin, context);
    addEntityToPlugin(vendurePlugin, entityClass);
    modifiedSourceFiles.push(entityClass.getSourceFile());
    if (context.features.translatable) {
        addEntityToPlugin(vendurePlugin, translationClass);
        modifiedSourceFiles.push(translationClass.getSourceFile());
    }

    entitySpinner.stop('Entity created');

    await project.save();

    return {
        project,
        modifiedSourceFiles,
        entityRef: new EntityRef(entityClass),
    };
}

async function getFeatures(options?: Partial<AddEntityOptions>): Promise<AddEntityOptions['features']> {
    if (options?.features) {
        return options?.features;
    }

    // Handle non-interactive mode with explicit feature flags
    if (options?.isNonInteractive) {
        return {
            customFields: options?.customFields ?? false,
            translatable: options?.translatable ?? false,
        };
    }

    // Default features for non-interactive mode when not specified
    if (options?.className && !options?.features) {
        return {
            customFields: true,
            translatable: false,
        };
    }

    const features = await withInteractiveTimeout(async () => {
        return await multiselect({
            message: 'Entity features (use ↑, ↓, space to select)',
            required: false,
            initialValues: ['customFields'],
            options: [
                {
                    label: 'Custom fields',
                    value: 'customFields',
                    hint: 'Adds support for custom fields on this entity',
                },
                {
                    label: 'Translatable',
                    value: 'translatable',
                    hint: 'Adds support for localized properties on this entity',
                },
            ],
        });
    });

    if (isCancel(features)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    return {
        customFields: features.includes('customFields'),
        translatable: features.includes('translatable'),
    };
}

function createEntity(plugin: VendurePluginRef, options: AddEntityOptions) {
    const entitiesDir = path.join(plugin.getPluginDir().getPath(), 'entities');
    const entityFile = createFile(
        plugin.getSourceFile().getProject(),
        path.join(__dirname, 'templates/entity.template.ts'),
        path.join(entitiesDir, `${options.fileName}.ts`),
    );
    const translationFile = createFile(
        plugin.getSourceFile().getProject(),
        path.join(__dirname, 'templates/entity-translation.template.ts'),
        path.join(entitiesDir, `${options.translationFileName}.ts`),
    );

    const entityClass = entityFile.getClass('ScaffoldEntity');
    const customFieldsClass = entityFile.getClass('ScaffoldEntityCustomFields');
    const translationClass = translationFile.getClass('ScaffoldTranslation');
    const translationCustomFieldsClass = translationFile.getClass('ScaffoldEntityCustomFieldsTranslation');

    if (!options.features.customFields) {
        // Remove custom fields from entity
        customFieldsClass?.remove();
        translationCustomFieldsClass?.remove();
        removeCustomFieldsFromClass(entityClass);
        removeCustomFieldsFromClass(translationClass);
    }
    if (!options.features.translatable) {
        // Remove translatable fields from entity
        translationClass?.remove();
        entityClass?.getProperty('localizedName')?.remove();
        entityClass?.getProperty('translations')?.remove();
        removeImplementsFromClass('Translatable', entityClass);
        translationFile.delete();
        entityFile.getImportDeclaration('./entity-translation.template')?.remove();
    } else {
        entityFile
            .getImportDeclaration('./entity-translation.template')
            ?.setModuleSpecifier(`./${options.translationFileName}`);
        translationFile
            .getImportDeclaration('./entity.template')
            ?.setModuleSpecifier(`./${options.fileName}`);
    }

    // Rename the entity classes
    entityClass?.rename(options.className);
    if (!customFieldsClass?.wasForgotten()) {
        customFieldsClass?.rename(`${options.className}CustomFields`);
    }
    if (!translationClass?.wasForgotten()) {
        translationClass?.rename(`${options.className}Translation`);
    }
    if (!translationCustomFieldsClass?.wasForgotten()) {
        translationCustomFieldsClass?.rename(`${options.className}CustomFieldsTranslation`);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { entityClass: entityClass!, translationClass: translationClass! };
}

function removeCustomFieldsFromClass(entityClass?: ClassDeclaration) {
    entityClass?.getProperty('customFields')?.remove();
    removeImplementsFromClass('HasCustomFields', entityClass);
}

function removeImplementsFromClass(implementsName: string, entityClass?: ClassDeclaration) {
    const index = entityClass?.getImplements().findIndex(i => i.getText() === implementsName) ?? -1;
    if (index > -1) {
        entityClass?.removeImplements(index);
    }
}

export async function getCustomEntityName(_cancelledMessage: string) {
    const entityName = await text({
        message: 'What is the name of the custom entity?',
        initialValue: '',
        validate: input => {
            if (!input) {
                return 'The custom entity name cannot be empty';
            }
            if (!pascalCaseRegex.test(input)) {
                return 'The custom entity name must be in PascalCase, e.g. "ProductReview"';
            }
        },
    });
    if (isCancel(entityName)) {
        cancel(_cancelledMessage);
        process.exit(0);
    }
    return pascalCase(entityName);
}
