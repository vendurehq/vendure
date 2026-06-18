import { VendurePluginMetadata } from '@vendure/core';
import {
    ClassDeclaration,
    InterfaceDeclaration,
    Node,
    PropertyAssignment,
    SyntaxKind,
    VariableDeclaration,
} from 'ts-morph';

import { AdminUiExtensionTypeName } from '../constants';

import { EntityRef } from './entity-ref';

export class VendurePluginRef {
    constructor(public classDeclaration: ClassDeclaration) {}

    get name(): string {
        return this.classDeclaration.getName() as string;
    }

    getSourceFile() {
        return this.classDeclaration.getSourceFile();
    }

    getPluginDir() {
        return this.classDeclaration.getSourceFile().getDirectory();
    }

    getMetadataOptions() {
        const pluginDecorator = this.classDeclaration.getDecorator('VendurePlugin');
        if (!pluginDecorator) {
            throw new Error('Could not find VendurePlugin decorator');
        }
        const pluginOptions = pluginDecorator.getArguments()[0];
        if (!pluginOptions || !Node.isObjectLiteralExpression(pluginOptions)) {
            throw new Error('Could not find VendurePlugin options');
        }
        return pluginOptions;
    }

    getPluginOptions():
        | { typeDeclaration: InterfaceDeclaration; constantDeclaration: VariableDeclaration }
        | undefined {
        const metadataOptions = this.getMetadataOptions();
        const staticOptions = this.classDeclaration.getStaticProperty('options');
        const typeDeclaration = staticOptions
            ?.getType()
            .getSymbolOrThrow()
            .getDeclarations()
            .find(d => Node.isInterfaceDeclaration(d));
        if (!typeDeclaration || !Node.isInterfaceDeclaration(typeDeclaration)) {
            return;
        }
        const providersArray = metadataOptions
            .getProperty('providers')
            ?.getFirstChildByKind(SyntaxKind.ArrayLiteralExpression);
        if (!providersArray) {
            return;
        }
        const elements = providersArray.getElements();
        const optionsProviders = elements
            .filter(Node.isObjectLiteralExpression)
            .filter(el => el.getProperty('useFactory')?.getText().includes(`${this.name}.options`));

        if (!optionsProviders.length) {
            return;
        }
        const optionsSymbol = optionsProviders[0].getProperty('provide') as PropertyAssignment;
        const initializer = optionsSymbol?.getInitializer();
        if (!initializer || !Node.isIdentifier(initializer)) {
            return;
        }
        const constantDeclaration = initializer.getDefinitions()[0]?.getDeclarationNode();
        if (!constantDeclaration || !Node.isVariableDeclaration(constantDeclaration)) {
            return;
        }

        return { typeDeclaration, constantDeclaration };
    }

    addEntity(entityClassName: string) {
        const pluginOptions = this.getMetadataOptions();
        const entityProperty = pluginOptions.getProperty('entities');
        if (entityProperty) {
            const entitiesArray = entityProperty.getFirstChildByKind(SyntaxKind.ArrayLiteralExpression);
            if (entitiesArray) {
                entitiesArray.addElement(entityClassName);
            }
        } else {
            pluginOptions.addPropertyAssignment({
                name: 'entities',
                initializer: `[${entityClassName}]`,
            });
        }
    }

    addProvider(providerClassName: string) {
        const pluginOptions = this.getMetadataOptions();
        const providerProperty = pluginOptions.getProperty('providers');
        if (providerProperty) {
            const providersArray = providerProperty.getFirstChildByKind(SyntaxKind.ArrayLiteralExpression);
            if (providersArray) {
                providersArray.addElement(providerClassName);
            }
        } else {
            pluginOptions.addPropertyAssignment({
                name: 'providers',
                initializer: `[${providerClassName}]`,
            });
        }
    }

    addAdminApiExtensions(extension: {
        schema: VariableDeclaration | undefined;
        resolvers: ClassDeclaration[];
    }) {
        const pluginOptions = this.getMetadataOptions();
        const adminApiExtensionsProperty = pluginOptions
            .getProperty('adminApiExtensions')
            ?.getType()
            .getSymbolOrThrow()
            .getDeclarations()[0];
        if (
            extension.schema &&
            adminApiExtensionsProperty &&
            Node.isObjectLiteralExpression(adminApiExtensionsProperty)
        ) {
            const schemaProp = adminApiExtensionsProperty.getProperty('schema');
            if (!schemaProp) {
                adminApiExtensionsProperty.addPropertyAssignment({
                    name: 'schema',
                    initializer: extension.schema?.getName(),
                });
            }
            const resolversProp = adminApiExtensionsProperty.getProperty('resolvers');
            if (resolversProp) {
                const resolversArray = resolversProp.getFirstChildByKind(SyntaxKind.ArrayLiteralExpression);
                if (resolversArray) {
                    for (const resolver of extension.resolvers) {
                        const resolverName = resolver.getName();
                        if (resolverName) {
                            resolversArray.addElement(resolverName);
                        }
                    }
                }
            } else {
                adminApiExtensionsProperty.addPropertyAssignment({
                    name: 'resolvers',
                    initializer: `[${extension.resolvers.map(r => r.getName()).join(', ')}]`,
                });
            }
        } else if (extension.schema) {
            pluginOptions
                .addPropertyAssignment({
                    name: 'adminApiExtensions',
                    initializer: `{
                        schema: ${extension.schema.getName()},
                        resolvers: [${extension.resolvers.map(r => r.getName()).join(', ')}]
                    }`,
                })
                .formatText();
        }
    }

    addMetadataProperty<K extends keyof VendurePluginMetadata>(prop: K, value: string) {
        const pluginOptions = this.getMetadataOptions();
        const existingProperty = pluginOptions.getProperty(prop);
        if (existingProperty) {
            const existingValue = Node.isPropertyAssignment(existingProperty)
                ? this.normalizeStringValue(existingProperty.getInitializer()?.getText())
                : existingProperty.getText();
            if (existingValue === value) {
                // Value is already set to the same, so we can
                // just return without changing anything
                return;
            }
            throw new Error(`Property '${prop}' already exists with a value of ${existingValue}`);
        }
        pluginOptions
            .addPropertyAssignment({
                name: prop,
                initializer: `'${value}'`,
            })
            .formatText();
    }

    getEntities(): EntityRef[] {
        const metadataOptions = this.getMetadataOptions();
        const entitiesProperty = metadataOptions.getProperty('entities');
        if (!entitiesProperty) {
            return [];
        }
        const entitiesArray = entitiesProperty.getFirstChildByKind(SyntaxKind.ArrayLiteralExpression);
        if (!entitiesArray) {
            return [];
        }
        const entityNames = entitiesArray
            .getElements()
            .filter(Node.isIdentifier)
            .map(e => e.getText());

        const entitySourceFiles = this.getSourceFile()
            .getImportDeclarations()
            .filter(imp => {
                for (const namedImport of imp.getNamedImports()) {
                    if (entityNames.includes(namedImport.getName())) {
                        return true;
                    }
                }
            })
            .map(imp => imp.getModuleSpecifierSourceFileOrThrow());
        return entitySourceFiles
            .map(sourceFile =>
                sourceFile.getClasses().filter(c => c.getExtends()?.getText() === 'VendureEntity'),
            )
            .flat()
            .map(classDeclaration => new EntityRef(classDeclaration));
    }

    hasUiExtensions(): boolean {
        return !!this.classDeclaration
            .getStaticProperties()
            .find(prop => prop.getType().getSymbol()?.getName() === AdminUiExtensionTypeName);
    }

    /**
     * Normalizes string values for comparison by removing quotes and handling nested string literals.
     *
     * When working with AST nodes via ts-morph, property initializers are returned as raw text
     * including their original quotation marks. For example:
     * - A property `foo: './path'` returns `"'./path'"` from getText()
     * - A property `foo: "./path"` returns `'"./path"'` from getText()
     *
     * This method ensures that when comparing these AST-derived strings with expected values,
     * we compare the actual semantic content rather than the literal representation including quotes.
     * This allows us to properly detect when a property already has the desired value and avoid
     * duplicate property assignments or incorrect error messages.
     *
     * @param value The raw string value from an AST node's getText() method
     * @returns The normalized string value without surrounding quotes
     */
    private normalizeStringValue(value: string | undefined): string {
        if (!value) return '';

        // Remove outer quotes (single or double)
        let normalized = value.trim();
        if (
            (normalized.startsWith('"') && normalized.endsWith('"')) ||
            (normalized.startsWith("'") && normalized.endsWith("'"))
        ) {
            normalized = normalized.slice(1, -1);
        }

        // Handle nested quoted strings by trying to parse as JSON
        try {
            const parsed = JSON.parse(`"${normalized}"`);
            if (typeof parsed === 'string') {
                return parsed;
            }
        } catch {
            // If JSON parsing fails, just return the normalized string
        }

        return normalized;
    }
}
