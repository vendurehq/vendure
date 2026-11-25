import fs from 'fs-extra';
import path from 'node:path';
import {
    Node,
    ObjectLiteralExpression,
    Project,
    SourceFile,
    SyntaxKind,
    VariableDeclaration,
} from 'ts-morph';

export class VendureConfigRef {
    readonly sourceFile: SourceFile;
    readonly configObject: ObjectLiteralExpression;

    constructor(
        private project: Project,
        configFilePath?: string,
    ) {
        if (configFilePath) {
            const sourceFile = project.getSourceFile(sf => sf.getFilePath().endsWith(configFilePath));
            if (!sourceFile) {
                throw new Error(`Could not find a config file at "${configFilePath}"`);
            }
            this.sourceFile = sourceFile;
        } else {
            const sourceFiles = project
                .getSourceFiles()
                .filter(sf => this.isVendureConfigFile(sf, { checkFileName: false }));
            if (sourceFiles.length > 1) {
                throw new Error(
                    `Multiple Vendure config files found. Please specify which one to use with the --config flag:\n` +
                        sourceFiles.map(sf => `  - ${sf.getFilePath()}`).join('\n'),
                );
            }
            if (sourceFiles.length === 0) {
                throw new Error('Could not find the VendureConfig declaration in your project.');
            }
            this.sourceFile = sourceFiles[0];
        }

        this.configObject = this.sourceFile
            .getVariableDeclarations()
            .find(v => this.isVendureConfigVariableDeclaration(v))
            ?.getChildren()
            .find(Node.isObjectLiteralExpression) as ObjectLiteralExpression;
    }

    getPathRelativeToProjectRoot() {
        return path.relative(
            this.project.getRootDirectories()[0]?.getPath() ?? '',
            this.sourceFile.getFilePath(),
        );
    }

    getConfigObjectVariableName() {
        return this.sourceFile
            ?.getVariableDeclarations()
            .find(v => this.isVendureConfigVariableDeclaration(v))
            ?.getName();
    }

    getPluginsArray() {
        return this.configObject
            .getProperty('plugins')
            ?.getFirstChildByKind(SyntaxKind.ArrayLiteralExpression);
    }

    addToPluginsArray(text: string) {
        this.getPluginsArray()?.addElement(text).formatText();
    }

    private isVendureConfigFile(
        sourceFile: SourceFile,
        options: { checkFileName?: boolean } = {},
    ): boolean {
        const checkFileName = options.checkFileName ?? true;
        return (
            (checkFileName ? sourceFile.getFilePath().endsWith('vendure-config.ts') : true) &&
            !!sourceFile.getVariableDeclarations().find(v => this.isVendureConfigVariableDeclaration(v))
        );
    }

    private isVendureConfigVariableDeclaration(v: VariableDeclaration) {
        return v.getType().getText(v) === 'VendureConfig';
    }
}
