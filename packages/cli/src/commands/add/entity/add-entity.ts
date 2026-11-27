import path from 'path';
import { ClassDeclaration, SourceFile } from 'ts-morph';

import { EntityRef } from '../../../shared/entity-ref.js';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref.js';
import { createFile } from '../../../utilities/ast-utils.js';
import { kebabCase } from '../../../utilities/case-utils.js';

import { addEntityToPlugin } from './codemods/add-entity-to-plugin/add-entity-to-plugin.js';

export interface AddEntityOptions {
    className: string;
    fileName: string;
    translationFileName: string;
    features: {
        customFields: boolean;
        translatable: boolean;
    };
}

/**
 * Creates an entity class, and its translation class when it is translatable, and adds them to
 * the plugin's `entities`. It prints nothing and does not save.
 */
export function scaffoldEntity(
    plugin: VendurePluginRef,
    className: string,
    features: AddEntityOptions['features'],
): { entityRef: EntityRef; created: SourceFile[]; edited: SourceFile[] } {
    const { entityClass, translationClass } = createEntity(plugin, {
        className,
        fileName: kebabCase(className) + '.entity',
        translationFileName: kebabCase(className) + '-translation.entity',
        features,
    });
    addEntityToPlugin(plugin, entityClass);
    const created = [entityClass.getSourceFile()];
    if (features.translatable) {
        addEntityToPlugin(plugin, translationClass);
        created.push(translationClass.getSourceFile());
    }
    return {
        entityRef: new EntityRef(entityClass),
        created,
        edited: [plugin.classDeclaration.getSourceFile()],
    };
}

/** The path of the entity file `scaffoldEntity` writes. */
export function entityFilePath(plugin: VendurePluginRef, className: string): string {
    return path.join(plugin.getPluginDir().getPath(), 'entities', `${kebabCase(className)}.entity.ts`);
}

function createEntity(plugin: VendurePluginRef, options: AddEntityOptions) {
    const entitiesDir = path.join(plugin.getPluginDir().getPath(), 'entities');
    const entityFile = createFile(
        plugin.getSourceFile().getProject(),
        path.join(import.meta.dirname, 'templates/entity.template.ts'),
        path.join(entitiesDir, `${options.fileName}.ts`),
    );
    const translationFile = createFile(
        plugin.getSourceFile().getProject(),
        path.join(import.meta.dirname, 'templates/entity-translation.template.ts'),
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
