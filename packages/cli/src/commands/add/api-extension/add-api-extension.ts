import path from 'path';
import {
    ClassDeclaration,
    CodeBlockWriter,
    Node,
    Project,
    SourceFile,
    SyntaxKind,
    Type,
    VariableDeclaration,
    VariableDeclarationKind,
} from 'ts-morph';

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
 * Adds an Admin API extension to a plugin, with a resolver that calls the service. For a CRUD
 * service of an entity, the extension has the entity's type, its queries and its mutations. For
 * any other service, it has the named query and mutation, each with a stub method on the service.
 * It prints nothing and does not save.
 */
export function scaffoldApiExtension(
    project: Project,
    plugin: VendurePluginRef,
    serviceRef: ServiceRef,
    names: { queryName?: string; mutationName?: string },
): { resolver: string; organize: SourceFile[]; edited: SourceFile[] } {
    const serviceEntityRef = serviceRef.crudEntityRef;
    const queryName = names.queryName ?? '';
    const mutationName = names.mutationName ?? '';
    const created: SourceFile[] = [];
    let resolver: ClassDeclaration;
    if (serviceEntityRef) {
        resolver = createCrudResolver(project, plugin, serviceRef, serviceEntityRef);
    } else {
        resolver = createSimpleResolver(project, plugin, serviceRef, queryName, mutationName);
        for (const method of [queryName, mutationName].filter(Boolean)) {
            serviceRef.classDeclaration.addMethod({
                name: method,
                parameters: [
                    { name: 'ctx', type: 'RequestContext' },
                    { name: 'id', type: 'ID' },
                ],
                isAsync: true,
                returnType: 'Promise<boolean>',
                statements: `return true;`,
            });
        }
        addImportsToFile(serviceRef.classDeclaration.getSourceFile(), {
            namedImports: ['RequestContext', 'ID'],
            moduleSpecifier: '@vendure/core',
        });
    }
    created.push(resolver.getSourceFile());

    const apiExtensions: VariableDeclaration | undefined = serviceEntityRef
        ? createCrudApiExtension(project, plugin, serviceRef)
        : createSimpleApiExtension(project, plugin, serviceRef, queryName, mutationName);
    if (apiExtensions) {
        created.push(apiExtensions.getSourceFile());
    }

    plugin.addAdminApiExtensions({ schema: apiExtensions, resolvers: [resolver] });
    addImportsToFile(plugin.getSourceFile(), {
        namedImports: [resolver.getName() as string],
        moduleSpecifier: resolver.getSourceFile(),
    });
    if (apiExtensions) {
        addImportsToFile(plugin.getSourceFile(), {
            namedImports: [apiExtensions.getName()],
            moduleSpecifier: apiExtensions.getSourceFile(),
        });
    }
    return {
        resolver: resolver.getName() as string,
        organize: created,
        edited: [serviceRef.classDeclaration.getSourceFile(), plugin.getSourceFile()],
    };
}

function getResolverFileName(
    project: Project,
    serviceRef: ServiceRef,
): { resolverFileName: string; suffix: number | undefined } {
    let suffix: number | undefined;
    let resolverFileName = '';
    let sourceFileExists = false;
    do {
        resolverFileName =
            kebabCase(serviceRef.name).replace('-service', '') +
            `-admin.resolver${typeof suffix === 'number' ? `-${suffix?.toString()}` : ''}.ts`;
        sourceFileExists = !!project.getSourceFile(resolverFileName);
        if (sourceFileExists) {
            suffix = (suffix ?? 1) + 1;
        }
    } while (sourceFileExists);
    return { resolverFileName, suffix };
}

function createSimpleResolver(
    project: Project,
    plugin: VendurePluginRef,
    serviceRef: ServiceRef,
    queryName: string,
    mutationName: string,
) {
    const { resolverFileName, suffix } = getResolverFileName(project, serviceRef);
    const resolverSourceFile = createFile(
        project,
        path.join(import.meta.dirname, 'templates/simple-resolver.template.ts'),
        path.join(plugin.getPluginDir().getPath(), 'api', resolverFileName),
    );

    const resolverClassDeclaration = resolverSourceFile
        .getClasses()
        .find(cl => cl.getDecorator('Resolver') != null);

    if (!resolverClassDeclaration) {
        throw new Error('Could not find resolver class declaration');
    }
    if (resolverClassDeclaration.getName() === 'SimpleAdminResolver') {
        resolverClassDeclaration.rename(
            serviceRef.name.replace(/Service$/, '') + 'AdminResolver' + (suffix ? suffix.toString() : ''),
        );
    }

    if (queryName) {
        resolverSourceFile.getClass('TemplateService')?.getMethod('exampleQueryHandler')?.rename(queryName);
        resolverClassDeclaration.getMethod('exampleQuery')?.rename(queryName);
    } else {
        resolverSourceFile.getClass('TemplateService')?.getMethod('exampleQueryHandler')?.remove();
        resolverClassDeclaration.getMethod('exampleQuery')?.remove();
    }

    if (mutationName) {
        resolverSourceFile
            .getClass('TemplateService')
            ?.getMethod('exampleMutationHandler')
            ?.rename(mutationName);
        resolverClassDeclaration.getMethod('exampleMutation')?.rename(mutationName);
    } else {
        resolverSourceFile.getClass('TemplateService')?.getMethod('exampleMutationHandler')?.remove();
        resolverClassDeclaration.getMethod('exampleMutation')?.remove();
    }

    resolverClassDeclaration
        .getConstructors()[0]
        .getParameter('templateService')
        ?.rename(serviceRef.nameCamelCase)
        .setType(serviceRef.name);

    resolverSourceFile.getClass('TemplateService')?.remove();
    addImportsToFile(resolverSourceFile, {
        namedImports: [serviceRef.name],
        moduleSpecifier: serviceRef.classDeclaration.getSourceFile(),
    });

    return resolverClassDeclaration;
}

function createCrudResolver(
    project: Project,
    plugin: VendurePluginRef,
    serviceRef: ServiceRef,
    serviceEntityRef: EntityRef,
) {
    const resolverSourceFile = createFile(
        project,
        path.join(import.meta.dirname, 'templates/crud-resolver.template.ts'),
        path.join(
            plugin.getPluginDir().getPath(),
            'api',
            kebabCase(serviceEntityRef.name) + '-admin.resolver.ts',
        ),
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const resolverClassDeclaration = resolverSourceFile
        .getClass('EntityAdminResolver')!
        .rename(serviceEntityRef.name + 'AdminResolver');

    if (serviceRef.features.findOne) {
        const findOneMethod = resolverClassDeclaration
            .getMethod('entity')
            ?.rename(serviceEntityRef.nameCamelCase);
        const serviceFindOneMethod = serviceRef.classDeclaration.getMethod('findOne');
        if (serviceFindOneMethod) {
            if (
                !serviceFindOneMethod
                    .getParameters()
                    .find(p => p.getName() === 'relations' && p.getType().getText().includes('RelationPaths'))
            ) {
                findOneMethod?.getParameters()[2].remove();
                findOneMethod?.setBodyText(`return this.${serviceRef.nameCamelCase}.findOne(ctx, args.id);`);
            }
        }
    } else {
        resolverClassDeclaration.getMethod('entity')?.remove();
    }

    if (serviceRef.features.findAll) {
        const findAllMethod = resolverClassDeclaration
            .getMethod('entities')
            ?.rename(serviceEntityRef.nameCamelCase + 's');
        const serviceFindAllMethod = serviceRef.classDeclaration.getMethod('findAll');
        if (serviceFindAllMethod) {
            if (
                !serviceFindAllMethod
                    .getParameters()
                    .find(p => p.getName() === 'relations' && p.getType().getText().includes('RelationPaths'))
            ) {
                findAllMethod?.getParameters()[2].remove();
                findAllMethod?.setBodyText(
                    `return this.${serviceRef.nameCamelCase}.findAll(ctx, args.options || undefined);`,
                );
            }
        }
    } else {
        resolverClassDeclaration.getMethod('entities')?.remove();
    }

    if (serviceRef.features.create) {
        resolverClassDeclaration.getMethod('createEntity')?.rename('create' + serviceEntityRef.name);
    } else {
        resolverClassDeclaration.getMethod('createEntity')?.remove();
    }

    if (serviceRef.features.update) {
        resolverClassDeclaration.getMethod('updateEntity')?.rename('update' + serviceEntityRef.name);
    } else {
        resolverClassDeclaration.getMethod('updateEntity')?.remove();
    }

    if (serviceRef.features.delete) {
        resolverClassDeclaration.getMethod('deleteEntity')?.rename('delete' + serviceEntityRef.name);
    } else {
        resolverClassDeclaration.getMethod('deleteEntity')?.remove();
    }

    customizeCreateUpdateInputInterfaces(resolverSourceFile, serviceEntityRef);

    resolverClassDeclaration
        .getConstructors()[0]
        .getParameter('templateService')
        ?.rename(serviceRef.nameCamelCase)
        .setType(serviceRef.name);
    resolverSourceFile.getClass('TemplateEntity')?.rename(serviceEntityRef.name).remove();
    resolverSourceFile.getClass('TemplateService')?.remove();

    addImportsToFile(resolverSourceFile, {
        namedImports: [serviceRef.name],
        moduleSpecifier: serviceRef.classDeclaration.getSourceFile(),
    });
    addImportsToFile(resolverSourceFile, {
        namedImports: [serviceEntityRef.name],
        moduleSpecifier: serviceEntityRef.classDeclaration.getSourceFile(),
    });

    return resolverClassDeclaration;
}

function createSimpleApiExtension(
    project: Project,
    plugin: VendurePluginRef,
    serviceRef: ServiceRef,
    queryName: string,
    mutationName: string,
) {
    const apiExtensionsFile = getOrCreateApiExtensionsFile(project, plugin);
    const adminApiExtensions = apiExtensionsFile.getVariableDeclaration('adminApiExtensions');
    const insertAtIndex = adminApiExtensions?.getParent().getParent().getChildIndex() ?? 2;
    const schemaVariableName = `${serviceRef.nameCamelCase.replace(/Service$/, '')}AdminApiExtensions`;
    const existingSchemaVariable = apiExtensionsFile.getVariableStatement(schemaVariableName);
    if (!existingSchemaVariable) {
        apiExtensionsFile.insertVariableStatement(insertAtIndex, {
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
                {
                    name: schemaVariableName,
                    initializer: writer => {
                        writer.writeLine(`gql\``);
                        writer.indent(() => {
                            if (queryName) {
                                writer.writeLine(`  extend type Query {`);
                                writer.writeLine(`    ${queryName}(id: ID!): Boolean!`);
                                writer.writeLine(`  }`);
                            }
                            writer.newLine();
                            if (mutationName) {
                                writer.writeLine(`  extend type Mutation {`);
                                writer.writeLine(`    ${mutationName}(id: ID!): Boolean!`);
                                writer.writeLine(`  }`);
                            }
                        });
                        writer.write(`\``);
                    },
                },
            ],
        });
    } else {
        const taggedTemplateLiteral = existingSchemaVariable
            .getDeclarations()[0]
            ?.getFirstChildByKind(SyntaxKind.TaggedTemplateExpression)
            ?.getChildren()[1];
        if (!taggedTemplateLiteral) {
            throw new Error(
                `The schema in ${existingSchemaVariable.getSourceFile().getFilePath()} is not a gql template literal, so it cannot be extended`,
            );
        } else {
            appendToGqlTemplateLiteral(existingSchemaVariable.getDeclarations()[0], writer => {
                writer.indent(() => {
                    if (queryName) {
                        writer.writeLine(`  extend type Query {`);
                        writer.writeLine(`    ${queryName}(id: ID!): Boolean!`);
                        writer.writeLine(`  }`);
                    }
                    writer.newLine();
                    if (mutationName) {
                        writer.writeLine(`  extend type Mutation {`);
                        writer.writeLine(`    ${mutationName}(id: ID!): Boolean!`);
                        writer.writeLine(`  }`);
                    }
                });
            });
        }
    }

    addSchemaToApiExtensionsTemplateLiteral(adminApiExtensions, schemaVariableName);

    return adminApiExtensions;
}

function createCrudApiExtension(project: Project, plugin: VendurePluginRef, serviceRef: ServiceRef) {
    const apiExtensionsFile = getOrCreateApiExtensionsFile(project, plugin);
    const adminApiExtensions = apiExtensionsFile.getVariableDeclaration('adminApiExtensions');
    const insertAtIndex = adminApiExtensions?.getParent().getParent().getChildIndex() ?? 2;
    const schemaVariableName = `${serviceRef.nameCamelCase.replace(/Service$/, '')}AdminApiExtensions`;
    apiExtensionsFile.insertVariableStatement(insertAtIndex, {
        declarationKind: VariableDeclarationKind.Const,
        declarations: [
            {
                name: schemaVariableName,
                initializer: writer => {
                    writer.writeLine(`gql\``);
                    const entityRef = serviceRef.crudEntityRef;
                    if (entityRef) {
                        writer.indent(() => {
                            if (entityRef.isTranslatable()) {
                                const translationClass = entityRef.getTranslationClass();
                                if (translationClass) {
                                    writer.writeLine(`  type ${translationClass.getName() ?? ''} {`);
                                    writer.writeLine(`    id: ID!`);
                                    writer.writeLine(`    createdAt: DateTime!`);
                                    writer.writeLine(`    updatedAt: DateTime!`);
                                    writer.writeLine(`    languageCode: LanguageCode!`);
                                    for (const { name, type, nullable } of entityRef.getProps()) {
                                        if (type.getText().includes('LocaleString')) {
                                            writer.writeLine(`    ${name}: String${nullable ? '' : '!'}`);
                                        }
                                    }
                                    writer.writeLine(`  }`);
                                    writer.newLine();
                                }
                            }
                            writer.writeLine(`  type ${entityRef.name} implements Node {`);
                            writer.writeLine(`    id: ID!`);
                            writer.writeLine(`    createdAt: DateTime!`);
                            writer.writeLine(`    updatedAt: DateTime!`);
                            for (const { name, type, nullable } of entityRef.getProps()) {
                                const graphQlType = getGraphQLType(type);
                                if (graphQlType) {
                                    writer.writeLine(`    ${name}: ${graphQlType}${nullable ? '' : '!'}`);
                                }
                            }
                            if (entityRef.isTranslatable()) {
                                writer.writeLine(
                                    `    translations: [${entityRef.getTranslationClass()?.getName() ?? ''}!]!`,
                                );
                            }
                            writer.writeLine(`  }`);
                            writer.newLine();

                            writer.writeLine(`  type ${entityRef.name}List implements PaginatedList {`);
                            writer.writeLine(`    items: [${entityRef.name}!]!`);
                            writer.writeLine(`    totalItems: Int!`);
                            writer.writeLine(`  }`);
                            writer.newLine();

                            writer.writeLine(`  # Generated at run-time by Vendure`);
                            writer.writeLine(`  input ${entityRef.name}ListOptions`);
                            writer.newLine();

                            writer.writeLine(`  extend type Query {`);

                            if (serviceRef.features.findOne) {
                                writer.writeLine(
                                    `    ${entityRef.nameCamelCase}(id: ID!): ${entityRef.name}`,
                                );
                            }
                            if (serviceRef.features.findAll) {
                                writer.writeLine(
                                    `    ${entityRef.nameCamelCase}s(options: ${entityRef.name}ListOptions): ${entityRef.name}List!`,
                                );
                            }
                            writer.writeLine(`  }`);
                            writer.newLine();

                            if (
                                entityRef.isTranslatable() &&
                                (serviceRef.features.create || serviceRef.features.update)
                            ) {
                                writer.writeLine(
                                    `  input ${entityRef.getTranslationClass()?.getName() ?? ''}Input {`,
                                );
                                writer.writeLine(`    id: ID`);
                                writer.writeLine(`    languageCode: LanguageCode!`);
                                for (const { name, type, nullable } of entityRef.getProps()) {
                                    if (type.getText().includes('LocaleString')) {
                                        writer.writeLine(`    ${name}: String`);
                                    }
                                }
                                writer.writeLine(`  }`);
                                writer.newLine();
                            }

                            if (serviceRef.features.create) {
                                writer.writeLine(`  input Create${entityRef.name}Input {`);
                                for (const { name, type, nullable } of entityRef.getProps()) {
                                    if (
                                        entityRef.isTranslatable() &&
                                        type.getText().includes('LocaleString')
                                    ) {
                                        continue;
                                    }
                                    const graphQlType = getGraphQLType(type);
                                    if (graphQlType) {
                                        writer.writeLine(`    ${name}: ${graphQlType}${nullable ? '' : '!'}`);
                                    }
                                }
                                if (entityRef.isTranslatable()) {
                                    writer.writeLine(
                                        `    translations: [${entityRef.getTranslationClass()?.getName() ?? ''}Input!]!`,
                                    );
                                }
                                writer.writeLine(`  }`);
                                writer.newLine();
                            }

                            if (serviceRef.features.update) {
                                writer.writeLine(`  input Update${entityRef.name}Input {`);
                                writer.writeLine(`    id: ID!`);
                                for (const { name, type } of entityRef.getProps()) {
                                    if (
                                        entityRef.isTranslatable() &&
                                        type.getText().includes('LocaleString')
                                    ) {
                                        continue;
                                    }
                                    const graphQlType = getGraphQLType(type);
                                    if (graphQlType) {
                                        writer.writeLine(`    ${name}: ${graphQlType}`);
                                    }
                                }
                                if (entityRef.isTranslatable()) {
                                    writer.writeLine(
                                        `    translations: [${entityRef.getTranslationClass()?.getName() ?? ''}Input!]`,
                                    );
                                }
                                writer.writeLine(`  }`);
                                writer.newLine();
                            }

                            if (
                                serviceRef.features.create ||
                                serviceRef.features.update ||
                                serviceRef.features.delete
                            ) {
                                writer.writeLine(`  extend type Mutation {`);
                                if (serviceRef.features.create) {
                                    writer.writeLine(
                                        `    create${entityRef.name}(input: Create${entityRef.name}Input!): ${entityRef.name}!`,
                                    );
                                }
                                if (serviceRef.features.update) {
                                    writer.writeLine(
                                        `    update${entityRef.name}(input: Update${entityRef.name}Input!): ${entityRef.name}!`,
                                    );
                                }
                                if (serviceRef.features.delete) {
                                    writer.writeLine(
                                        `    delete${entityRef.name}(id: ID!): DeletionResponse!`,
                                    );
                                }
                                writer.writeLine(`  }`);
                            }
                        });
                    }
                    writer.write(`\``);
                },
            },
        ],
    });

    addSchemaToApiExtensionsTemplateLiteral(adminApiExtensions, schemaVariableName);

    return adminApiExtensions;
}

function addSchemaToApiExtensionsTemplateLiteral(
    adminApiExtensions: VariableDeclaration | undefined,
    schemaVariableName: string,
) {
    if (adminApiExtensions) {
        if (adminApiExtensions.getText().includes(`  \${${schemaVariableName}}`)) {
            return;
        }
        appendToGqlTemplateLiteral(adminApiExtensions, writer => {
            writer.writeLine(`  \${${schemaVariableName}}`);
        });
    }
}

function appendToGqlTemplateLiteral(
    variableDeclaration: VariableDeclaration,
    append: (writer: CodeBlockWriter) => void,
) {
    const initializer = variableDeclaration.getInitializer();
    if (Node.isTaggedTemplateExpression(initializer)) {
        variableDeclaration
            .setInitializer(writer => {
                writer.write(`gql\``);
                const template = initializer.getTemplate();
                if (Node.isNoSubstitutionTemplateLiteral(template)) {
                    writer.write(`${template.getLiteralValue()}`);
                } else {
                    writer.write(template.getText().replace(/^`/, '').replace(/`$/, ''));
                }
                append(writer);
                writer.write(`\``);
            })
            .formatText();
    }
}

function getGraphQLType(type: Type): string | undefined {
    if (type.isString()) {
        return 'String';
    }
    if (type.isBoolean()) {
        return 'Boolean';
    }
    if (type.isNumber()) {
        return 'Int';
    }
    if (type.isObject() && type.getText() === 'Date') {
        return 'DateTime';
    }
    if (type.getText().includes('LocaleString')) {
        return 'String';
    }
    return;
}

function getOrCreateApiExtensionsFile(project: Project, plugin: VendurePluginRef): SourceFile {
    const existingApiExtensionsFile = project.getSourceFiles().find(sf => {
        const filePath = sf.getDirectory().getPath();
        return (
            sf.getBaseName() === 'api-extensions.ts' &&
            filePath.includes(plugin.getPluginDir().getPath()) &&
            filePath.endsWith('/api')
        );
    });
    if (existingApiExtensionsFile) {
        return existingApiExtensionsFile;
    }
    return createFile(
        project,
        path.join(import.meta.dirname, 'templates/api-extensions.template.ts'),
        path.join(plugin.getPluginDir().getPath(), 'api', 'api-extensions.ts'),
    );
}
