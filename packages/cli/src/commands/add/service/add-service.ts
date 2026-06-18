import { cancel, isCancel, log, select, spinner, text } from '@clack/prompts';
import { paramCase } from 'change-case';
import path from 'path';
import { ClassDeclaration, Scope, SourceFile } from 'ts-morph';

import { Messages, pascalCaseRegex } from '../../../constants';
import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { EntityRef } from '../../../shared/entity-ref';
import { ServiceRef } from '../../../shared/service-ref';
import { analyzeProject, selectEntity, selectPlugin } from '../../../shared/shared-prompts';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref';
import {
    addImportsToFile,
    createFile,
    customizeCreateUpdateInputInterfaces,
    getPluginClasses,
} from '../../../utilities/ast-utils';
import { pauseForPromptDisplay, withInteractiveTimeout } from '../../../utilities/utils';
import { addEntityCommand } from '../entity/add-entity';

const cancelledMessage = 'Add service cancelled';

interface AddServiceOptions {
    plugin?: VendurePluginRef;
    type: 'basic' | 'entity';
    serviceName: string;
    entityRef?: EntityRef;
    config?: string;
    isNonInteractive?: boolean;
    pluginName?: string;
    serviceType?: string;
    selectedEntityName?: string;
}

export const addServiceCommand = new CliCommand({
    id: 'add-service',
    category: 'Plugin: Service',
    description: 'Add a new service to a plugin',
    run: options => addService(options),
});

export async function addService(
    providedOptions?: Partial<AddServiceOptions>,
): Promise<CliCommandReturnVal<{ serviceRef: ServiceRef }>> {
    const providedVendurePlugin = providedOptions?.plugin;
    const { project } = await analyzeProject({
        providedVendurePlugin,
        cancelledMessage,
        config: providedOptions?.config,
    });

    // In non-interactive mode with no plugin specified, we cannot proceed
    const isNonInteractive = providedOptions?.serviceName !== undefined || providedOptions?.isNonInteractive;
    if (isNonInteractive && !providedVendurePlugin && !providedOptions?.pluginName) {
        throw new Error(
            'Plugin must be specified when running in non-interactive mode. Use selectPlugin in interactive mode.',
        );
    }

    let vendurePlugin = providedVendurePlugin;

    // If pluginName is provided (from CLI), find the plugin by name
    if (providedOptions?.pluginName && !vendurePlugin) {
        const pluginClasses = getPluginClasses(project);
        const pluginClass = pluginClasses.find(
            (p: ClassDeclaration) => p.getName() === providedOptions.pluginName,
        );
        if (!pluginClass) {
            const availablePlugins = pluginClasses.map((p: ClassDeclaration) => p.getName()).join(', ');
            throw new Error(
                `Plugin "${providedOptions.pluginName}" not found. Available plugins: ${availablePlugins}`,
            );
        }
        vendurePlugin = new VendurePluginRef(pluginClass);
    }

    vendurePlugin = vendurePlugin ?? (await selectPlugin(project, cancelledMessage));
    const modifiedSourceFiles: SourceFile[] = [];
    const type =
        providedOptions?.type ??
        (providedOptions?.serviceType as 'basic' | 'entity') ??
        (isNonInteractive
            ? 'basic'
            : await withInteractiveTimeout(async () => {
                  return await select({
                      message: 'What type of service would you like to add?',
                      options: [
                          { value: 'basic', label: 'Basic empty service' },
                          { value: 'entity', label: 'Service to perform CRUD operations on an entity' },
                      ],
                      maxItems: 10,
                  });
              }));
    if (!isNonInteractive && isCancel(type)) {
        cancel('Cancelled');
        process.exit(0);
    }
    const options: AddServiceOptions = {
        type,
        serviceName: providedOptions?.serviceName ?? 'MyService',
        config: providedOptions?.config,
    };
    if (type === 'entity') {
        let entityRef: EntityRef;

        // If selectedEntityName is provided (non-interactive mode), find the entity by name
        if (providedOptions?.selectedEntityName && isNonInteractive) {
            const entities = vendurePlugin.getEntities();
            const foundEntity = entities.find(entity => entity.name === providedOptions.selectedEntityName);

            if (!foundEntity) {
                const availableEntities = entities.map(entity => entity.name).join(', ');
                throw new Error(
                    `Entity "${providedOptions.selectedEntityName}" not found in plugin "${vendurePlugin.name}". Available entities: ${availableEntities || 'none'}`,
                );
            }
            entityRef = foundEntity;
        } else {
            // Interactive mode or no selectedEntityName provided
            try {
                entityRef = await selectEntity(vendurePlugin);
            } catch (e: any) {
                if (e.message === Messages.NoEntitiesFound) {
                    log.info(`No entities found in plugin ${vendurePlugin.name}. Let's create one first.`);
                    const result = await addEntityCommand.run({ plugin: vendurePlugin });
                    entityRef = result.entityRef;
                    modifiedSourceFiles.push(...result.modifiedSourceFiles);
                } else {
                    throw e;
                }
            }
        }
        options.entityRef = entityRef;
        options.serviceName = `${entityRef.name}Service`;
    }

    const serviceSpinner = spinner();

    let serviceSourceFile: SourceFile;
    let serviceClassDeclaration: ClassDeclaration;
    if (options.type === 'basic') {
        const name =
            options.serviceName !== 'MyService'
                ? options.serviceName
                : await text({
                      message: 'What is the name of the new service?',
                      initialValue: 'MyService',
                      validate: input => {
                          if (!input) {
                              return 'The service name cannot be empty';
                          }
                          if (!pascalCaseRegex.test(input)) {
                              return 'The service name must be in PascalCase, e.g. "MyService"';
                          }
                      },
                  });

        if (!isNonInteractive && isCancel(name)) {
            cancel(cancelledMessage);
            process.exit(0);
        }

        options.serviceName = name as string;
        serviceSpinner.start(`Creating ${options.serviceName}...`);
        const serviceSourceFilePath = getServiceFilePath(vendurePlugin, options.serviceName);
        await pauseForPromptDisplay();
        serviceSourceFile = createFile(
            project,
            path.join(__dirname, 'templates/basic-service.template.ts'),
            serviceSourceFilePath,
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        serviceClassDeclaration = serviceSourceFile
            .getClass('BasicServiceTemplate')!
            .rename(options.serviceName);
    } else {
        serviceSpinner.start(`Creating ${options.serviceName}...`);
        await pauseForPromptDisplay();
        const serviceSourceFilePath = getServiceFilePath(vendurePlugin, options.serviceName);
        serviceSourceFile = createFile(
            project,
            path.join(__dirname, 'templates/entity-service.template.ts'),
            serviceSourceFilePath,
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        serviceClassDeclaration = serviceSourceFile
            .getClass('EntityServiceTemplate')!
            .rename(options.serviceName);
        const entityRef = options.entityRef;
        if (!entityRef) {
            throw new Error('Entity class not found');
        }
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
    modifiedSourceFiles.push(serviceSourceFile);

    serviceSpinner.message(`Registering service with plugin...`);

    vendurePlugin.addProvider(options.serviceName);
    addImportsToFile(vendurePlugin.classDeclaration.getSourceFile(), {
        moduleSpecifier: serviceSourceFile,
        namedImports: [options.serviceName],
    });

    await project.save();

    serviceSpinner.stop(`${options.serviceName} created`);

    return {
        project,
        modifiedSourceFiles,
        serviceRef: new ServiceRef(serviceClassDeclaration),
    };
}

function getServiceFilePath(plugin: VendurePluginRef, serviceName: string) {
    const serviceFileName = paramCase(serviceName).replace(/-service$/, '.service');
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
