import path from 'path';
import { ClassDeclaration, Project, Scope, SourceFile } from 'ts-morph';

import { EntityRef } from '../../../shared/entity-ref.js';
import { ServiceRef } from '../../../shared/service-ref.js';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref.js';
import {
    addImportsToFile,
    createFile,
    customizeCreateUpdateInputInterfaces,
} from '../../../utilities/ast-utils.js';
import { kebabCase } from '../../../utilities/case-utils.js';

/**
 * Creates a service in a plugin and registers it as a provider. With an entity, it is a CRUD
 * service for that entity, from the entity service template. It prints nothing and does not save.
 */
export function scaffoldService(
    project: Project,
    vendurePlugin: VendurePluginRef,
    options: { serviceName: string; entityRef?: EntityRef },
): { serviceRef: ServiceRef; created: SourceFile[]; edited: SourceFile[] } {
    const serviceSourceFilePath = serviceFilePath(vendurePlugin, options.serviceName);
    let serviceSourceFile: SourceFile;
    let serviceClassDeclaration: ClassDeclaration;
    if (!options.entityRef) {
        serviceSourceFile = createFile(
            project,
            path.join(import.meta.dirname, 'templates/basic-service.template.ts'),
            serviceSourceFilePath,
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        serviceClassDeclaration = serviceSourceFile
            .getClass('BasicServiceTemplate')!
            .rename(options.serviceName);
    } else {
        serviceSourceFile = createFile(
            project,
            path.join(import.meta.dirname, 'templates/entity-service.template.ts'),
            serviceSourceFilePath,
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        serviceClassDeclaration = serviceSourceFile
            .getClass('EntityServiceTemplate')!
            .rename(options.serviceName);
        const entityRef = options.entityRef;
        const templateEntityClass = serviceSourceFile.getClass('TemplateEntity');
        if (templateEntityClass) {
            templateEntityClass.rename(entityRef.name);
            templateEntityClass.remove();
        }
        addImportsToFile(serviceClassDeclaration.getSourceFile(), {
            moduleSpecifier: entityRef.classDeclaration.getSourceFile(),
            namedImports: [entityRef.name],
        });
        const templateTranslationEntityClass = serviceSourceFile.getClass('TemplateEntityTranslation');
        if (entityRef.isTranslatable()) {
            const translationEntityClass = entityRef.getTranslationClass();
            if (translationEntityClass && templateTranslationEntityClass) {
                templateTranslationEntityClass.rename(translationEntityClass?.getName() as string);
                templateTranslationEntityClass.remove();

                addImportsToFile(serviceClassDeclaration.getSourceFile(), {
                    moduleSpecifier: translationEntityClass.getSourceFile(),
                    namedImports: [translationEntityClass.getName() as string],
                });
            }
        } else {
            templateTranslationEntityClass?.remove();
        }
        customizeCreateUpdateInputInterfaces(serviceSourceFile, entityRef);
        customizeFindOneMethod(serviceClassDeclaration, entityRef);
        customizeFindAllMethod(serviceClassDeclaration, entityRef);
        customizeCreateMethod(serviceClassDeclaration, entityRef);
        customizeUpdateMethod(serviceClassDeclaration, entityRef);
        removedUnusedConstructorArgs(serviceClassDeclaration, entityRef);
    }
    const pluginOptions = vendurePlugin.getPluginOptions();
    if (pluginOptions) {
        addImportsToFile(serviceSourceFile, {
            moduleSpecifier: pluginOptions.constantDeclaration.getSourceFile(),
            namedImports: [pluginOptions.constantDeclaration.getName()],
        });
        addImportsToFile(serviceSourceFile, {
            moduleSpecifier: pluginOptions.typeDeclaration.getSourceFile(),
            namedImports: [pluginOptions.typeDeclaration.getName()],
        });
        addImportsToFile(serviceSourceFile, {
            moduleSpecifier: '@nestjs/common',
            namedImports: ['Inject'],
        });
        serviceClassDeclaration
            .getConstructors()[0]
            ?.addParameter({
                scope: Scope.Private,
                name: 'options',
                type: pluginOptions.typeDeclaration.getName(),
                decorators: [{ name: 'Inject', arguments: [pluginOptions.constantDeclaration.getName()] }],
            })
            .formatText();
    }

    vendurePlugin.addProvider(options.serviceName);
    addImportsToFile(vendurePlugin.classDeclaration.getSourceFile(), {
        moduleSpecifier: serviceSourceFile,
        namedImports: [options.serviceName],
    });
    return {
        serviceRef: new ServiceRef(serviceClassDeclaration),
        created: [serviceSourceFile],
        edited: [vendurePlugin.classDeclaration.getSourceFile()],
    };
}

/** The path of the service file `scaffoldService` writes. */
export function serviceFilePath(plugin: VendurePluginRef, serviceName: string) {
    const serviceFileName = kebabCase(serviceName).replace(/-service$/, '.service');
    return path.join(plugin.getPluginDir().getPath(), 'services', `${serviceFileName}.ts`);
}

function customizeFindOneMethod(serviceClassDeclaration: ClassDeclaration, entityRef: EntityRef) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const findOneMethod = serviceClassDeclaration.getMethod('findOne')!;
    findOneMethod
        .setBodyText(writer => {
            writer.write(` return this.connection
            .getRepository(ctx, ${entityRef.name})
            .findOne({
                where: { id },
                relations,
            })`);
            if (entityRef.isTranslatable()) {
                writer.write(`.then(entity => entity && this.translator.translate(entity, ctx));`);
            } else {
                writer.write(`;`);
            }
        })
        .formatText();
    if (!entityRef.isTranslatable()) {
        findOneMethod.setReturnType(`Promise<${entityRef.name} | null>`);
    }
}

function customizeFindAllMethod(serviceClassDeclaration: ClassDeclaration, entityRef: EntityRef) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const findAllMethod = serviceClassDeclaration.getMethod('findAll')!;
    findAllMethod
        .setBodyText(writer => {
            writer.writeLine(`return this.listQueryBuilder`);
            writer.write(`.build(${entityRef.name}, options,`).block(() => {
                writer.writeLine('relations,');
                writer.writeLine('ctx,');
            });
            writer.write(')');
            writer.write('.getManyAndCount()');
            writer.write('.then(([items, totalItems]) =>').block(() => {
                writer.write('return').block(() => {
                    if (entityRef.isTranslatable()) {
                        writer.writeLine('items: items.map(item => this.translator.translate(item, ctx)),');
                    } else {
                        writer.writeLine('items,');
                    }
                    writer.writeLine('totalItems,');
                });
            });
            writer.write(');');
        })
        .formatText();
    if (!entityRef.isTranslatable()) {
        findAllMethod.setReturnType(`Promise<PaginatedList<${entityRef.name}>>`);
    }
}

function customizeCreateMethod(serviceClassDeclaration: ClassDeclaration, entityRef: EntityRef) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const createMethod = serviceClassDeclaration.getMethod('create')!;
    createMethod
        .setBodyText(writer => {
            if (entityRef.isTranslatable()) {
                writer.write(`const newEntity = await this.translatableSaver.create({
                                ctx,
                                input,
                                entityType: ${entityRef.name},
                                translationType: ${entityRef.getTranslationClass()?.getName() as string},
                                beforeSave: async f => {
                                    // Any pre-save logic can go here
                                },
                            });`);
            } else {
                writer.writeLine(
                    `const newEntityInstance = new ${entityRef.name}(input);
                    const newEntity = await this.connection.getRepository(ctx, ${entityRef.name}).save(newEntityInstance);`,
                );
            }
            if (entityRef.hasCustomFields()) {
                writer.writeLine(
                    `await this.customFieldRelationService.updateRelations(ctx, ${entityRef.name}, input, newEntity);`,
                );
            }
            writer.writeLine(`return assertFound(this.findOne(ctx, newEntity.id));`);
        })
        .formatText();
    if (!entityRef.isTranslatable()) {
        createMethod.setReturnType(`Promise<${entityRef.name}>`);
    }
}

function customizeUpdateMethod(serviceClassDeclaration: ClassDeclaration, entityRef: EntityRef) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const updateMethod = serviceClassDeclaration.getMethod('update')!;
    updateMethod
        .setBodyText(writer => {
            if (entityRef.isTranslatable()) {
                writer.write(`const updatedEntity = await this.translatableSaver.update({
                                ctx,
                                input,
                                entityType: ${entityRef.name},
                                translationType: ${entityRef.getTranslationClass()?.getName() as string},
                                beforeSave: async f => {
                                    // Any pre-save logic can go here
                                },
                            });`);
            } else {
                writer.writeLine(
                    `const entity = await this.connection.getEntityOrThrow(ctx, ${entityRef.name}, input.id);`,
                );
                writer.writeLine(`const updatedEntity = patchEntity(entity, input);`);
                writer.writeLine(
                    `await this.connection.getRepository(ctx, ${entityRef.name}).save(updatedEntity, { reload: false });`,
                );
            }
            if (entityRef.hasCustomFields()) {
                writer.writeLine(
                    `await this.customFieldRelationService.updateRelations(ctx, ${entityRef.name}, input, updatedEntity);`,
                );
            }
            writer.writeLine(`return assertFound(this.findOne(ctx, updatedEntity.id));`);
        })
        .formatText();
    if (!entityRef.isTranslatable()) {
        updateMethod.setReturnType(`Promise<${entityRef.name}>`);
    }
}

function removedUnusedConstructorArgs(serviceClassDeclaration: ClassDeclaration, entityRef: EntityRef) {
    const isTranslatable = entityRef.isTranslatable();
    const hasCustomFields = entityRef.hasCustomFields();
    serviceClassDeclaration.getConstructors().forEach(constructor => {
        constructor.getParameters().forEach(param => {
            const paramName = param.getName();
            if ((paramName === 'translatableSaver' || paramName === 'translator') && !isTranslatable) {
                param.remove();
            }
            if (paramName === 'customFieldRelationService' && !hasCustomFields) {
                param.remove();
            }
        });
    });
}
