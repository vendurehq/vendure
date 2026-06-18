import { ClassDeclaration, Node, Scope, Type } from 'ts-morph';

import { EntityRef } from './entity-ref';

export interface ServiceFeatures {
    findOne: boolean;
    findAll: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
}

export class ServiceRef {
    readonly features: ServiceFeatures;
    readonly crudEntityRef?: EntityRef;

    get name(): string {
        return this.classDeclaration.getName() as string;
    }

    get nameCamelCase(): string {
        return this.name.charAt(0).toLowerCase() + this.name.slice(1);
    }

    get isCrudService(): boolean {
        return this.crudEntityRef !== undefined;
    }

    constructor(public readonly classDeclaration: ClassDeclaration) {
        this.features = {
            findOne: !!this.classDeclaration.getMethod('findOne'),
            findAll: !!this.classDeclaration.getMethod('findAll'),
            create: !!this.classDeclaration.getMethod('create'),
            update: !!this.classDeclaration.getMethod('update'),
            delete: !!this.classDeclaration.getMethod('delete'),
        };
        this.crudEntityRef = this.getEntityRef();
    }

    injectDependency(dependency: { scope?: Scope; name: string; type: string }) {
        for (const constructorDeclaration of this.classDeclaration.getConstructors()) {
            const existingParam = constructorDeclaration.getParameter(dependency.name);
            if (!existingParam) {
                constructorDeclaration.addParameter({
                    name: dependency.name,
                    type: dependency.type,
                    hasQuestionToken: false,
                    isReadonly: false,
                    scope: dependency.scope ?? Scope.Private,
                });
            }
        }
    }

    private getEntityRef(): EntityRef | undefined {
        if (this.features.findOne) {
            const potentialCrudMethodNames = ['findOne', 'findAll', 'create', 'update', 'delete'];
            for (const methodName of potentialCrudMethodNames) {
                const findOneMethod = this.classDeclaration.getMethod(methodName);
                const returnType = findOneMethod?.getReturnType();
                if (returnType) {
                    const unwrappedReturnType = this.unwrapReturnType(returnType);
                    const typeDeclaration = unwrappedReturnType.getSymbolOrThrow().getDeclarations()[0];
                    if (typeDeclaration && Node.isClassDeclaration(typeDeclaration)) {
                        if (typeDeclaration.getExtends()?.getText() === 'VendureEntity') {
                            return new EntityRef(typeDeclaration);
                        }
                    }
                }
            }
        }
        return;
    }

    private unwrapReturnType(returnType: Type): Type {
        if (returnType.isUnion()) {
            // get the non-null part of the union
            const nonNullType = returnType.getUnionTypes().find(t => !t.isNull() && !t.isUndefined());
            if (!nonNullType) {
                throw new Error('Could not find non-null type in union');
            }
            return this.unwrapReturnType(nonNullType);
        }
        const typeArguments = returnType.getTypeArguments();
        if (typeArguments.length) {
            return this.unwrapReturnType(typeArguments[0]);
        }
        const aliasTypeArguments = returnType.getAliasTypeArguments();
        if (aliasTypeArguments.length) {
            return this.unwrapReturnType(aliasTypeArguments[0]);
        }
        return returnType;
    }
}
