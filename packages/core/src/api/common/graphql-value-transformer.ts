import {
    ASTVisitor,
    DocumentNode,
    getNamedType,
    GraphQLInputObjectType,
    GraphQLNamedType,
    GraphQLSchema,
    isInputObjectType,
    isListType,
    isNonNullType,
    OperationDefinitionNode,
    TypeInfo,
    visit,
    visitWithTypeInfo,
} from 'graphql';

export type TypeTree = {
    operation: TypeTreeNode;
    fragments: { [name: string]: TypeTreeNode };
};

/**
 * Represents a GraphQLNamedType which pertains to an input variables object or an output.
 * Used when traversing the data object in order to provide the type for the field
 * being visited.
 */
export type TypeTreeNode = {
    type: GraphQLNamedType | undefined;
    parent: TypeTreeNode | TypeTree;
    isList: boolean;
    fragmentRefs: string[];
    children: { [name: string]: TypeTreeNode };
};

/**
 * This class is used to transform the values of input variables or an output object.
 */
export class GraphqlValueTransformer {
    private outputCache = new WeakMap<DocumentNode, TypeTree>();
    private inputCache = new WeakMap<OperationDefinitionNode, TypeTree>();
    constructor(private schema: GraphQLSchema) {}

    /**
     * Transforms the values in the `data` object into the return value of the `visitorFn`.
     */
    transformValues(
        typeTree: TypeTree,
        data: Record<string, unknown>,
        visitorFn: (value: any, type: GraphQLNamedType) => any,
    ) {
        this.traverse(data, (key, value, path) => {
            const typeTreeNode = this.getTypeNodeByPath(typeTree, path);
            const type = (typeTreeNode && typeTreeNode.type) as GraphQLNamedType;
            return visitorFn(value, type);
        });
    }

    /**
     * Constructs a tree of TypeTreeNodes for the output of a GraphQL operation.
     */
    getOutputTypeTree(document: DocumentNode): TypeTree {
        const cached = this.outputCache.get(document);
        if (cached) {
            return cached;
        }
        const typeInfo = new TypeInfo(this.schema);
        const typeTree: TypeTree = {
            operation: {} as any,
            fragments: {},
        };
        const rootNode: TypeTreeNode = {
            type: undefined,
            isList: false,
            parent: typeTree,
            fragmentRefs: [],
            children: {},
        };
        typeTree.operation = rootNode;
        let currentNode = rootNode;
        const visitor: ASTVisitor = {
            enter: node => {
                const type = typeInfo.getType();
                const fieldDef = typeInfo.getFieldDef();
                if (node.kind === 'Field') {
                    const newNode: TypeTreeNode = {
                        type: (type && getNamedType(type)) || undefined,
                        isList: this.isList(type),
                        fragmentRefs: [],
                        parent: currentNode,
                        children: {},
                    };
                    currentNode.children[node.alias?.value ?? node.name.value] = newNode;
                    currentNode = newNode;
                }
                if (node.kind === 'FragmentSpread') {
                    currentNode.fragmentRefs.push(node.name.value);
                }
                if (node.kind === 'FragmentDefinition') {
                    const rootFragmentNode: TypeTreeNode = {
                        type: undefined,
                        isList: false,
                        fragmentRefs: [],
                        parent: typeTree,
                        children: {},
                    };
                    currentNode = rootFragmentNode;
                    typeTree.fragments[node.name.value] = rootFragmentNode;
                }
            },
            leave: node => {
                if (node.kind === 'Field') {
                    if (!this.isTypeTree(currentNode.parent)) {
                        currentNode = currentNode.parent;
                    }
                }
                if (node.kind === 'FragmentDefinition') {
                    currentNode = rootNode;
                }
            },
        };
        for (const operation of document.definitions) {
            visit(operation, visitWithTypeInfo(typeInfo, visitor));
        }
        this.outputCache.set(document, typeTree);
        return typeTree;
    }

    /**
     * Constructs a tree of TypeTreeNodes for the input variables of a GraphQL operation.
     */
    getInputTypeTree(definition: OperationDefinitionNode): TypeTree {
        const cached = this.inputCache.get(definition);
        if (cached) {
            return cached;
        }
        const typeInfo = new TypeInfo(this.schema);
        const typeTree: TypeTree = {
            operation: {} as any,
            fragments: {},
        };
        const rootNode: TypeTreeNode = {
            type: undefined,
            isList: false,
            parent: typeTree,
            fragmentRefs: [],
            children: {},
        };
        typeTree.operation = rootNode;
        let currentNode = rootNode;
        const visitor: ASTVisitor = {
            enter: node => {
                if (node.kind === 'Argument') {
                    const type = typeInfo.getType();
                    const args = typeInfo.getArgument();
                    if (args) {
                        const inputType = getNamedType(args.type);
                        const newNode: TypeTreeNode = {
                            type: inputType || undefined,
                            isList: this.isList(type),
                            parent: currentNode,
                            fragmentRefs: [],
                            children: {},
                        };
                        currentNode.children[args.name] = newNode;
                        if (isInputObjectType(inputType)) {
                            if (isInputObjectType(inputType)) {
                                newNode.children = this.getChildrenTreeNodes(inputType, newNode);
                            }
                        }
                        currentNode = newNode;
                    }
                }
            },
            leave: node => {
                if (node.kind === 'Argument') {
                    if (!this.isTypeTree(currentNode.parent)) {
                        currentNode = currentNode.parent;
                    }
                }
            },
        };
        visit(definition, visitWithTypeInfo(typeInfo, visitor));
        this.inputCache.set(definition, typeTree);
        return typeTree;
    }

    private getChildrenTreeNodes(
        inputType: GraphQLInputObjectType,
        parent: TypeTreeNode,
        depth = 0,
    ): { [name: string]: TypeTreeNode } {
        if (depth > 3) return {};

        return Object.entries(inputType.getFields()).reduce(
            (result, [key, field]) => {
                const namedType = getNamedType(field.type);
                if (namedType === parent.type) {
                    // Allow _and/_or self-references in filter types, but limit depth to prevent infinite loops
                    if (key === '_and' || key === '_or') {
                        const selfRefChild: TypeTreeNode = {
                            type: namedType,
                            isList: this.isList(field.type),
                            parent,
                            fragmentRefs: [],
                            children: {},
                        };
                        if (isInputObjectType(namedType)) {
                            selfRefChild.children = this.getChildrenTreeNodes(
                                namedType,
                                selfRefChild,
                                depth + 1,
                            );
                        }
                        result[key] = selfRefChild;
                        return result;
                    }
                    return result;
                }
                const child: TypeTreeNode = {
                    type: namedType,
                    isList: this.isList(field.type),
                    parent,
                    fragmentRefs: [],
                    children: {},
                };
                if (isInputObjectType(namedType)) {
                    child.children = this.getChildrenTreeNodes(namedType, child);
                }
                return { ...result, [key]: child };
            },
            {} as { [name: string]: TypeTreeNode },
        );
    }

    private isList(t: any): boolean {
        return isListType(t) || (isNonNullType(t) && isListType(t.ofType));
    }

    private deepMergeChildren(
        target: { [name: string]: TypeTreeNode },
        source: { [name: string]: TypeTreeNode },
    ): { [name: string]: TypeTreeNode } {
        const merged = { ...target };
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (merged[key]) {
                    // If the key already exists, merge recursively
                    if (source[key].children && Object.keys(source[key].children).length > 0) {
                        merged[key].children = this.deepMergeChildren(
                            merged[key].children,
                            source[key].children,
                        );
                    }
                    // Merge fragmentRefs from both nodes, avoiding duplicates
                    if (source[key].fragmentRefs && source[key].fragmentRefs.length > 0) {
                        const existingRefs = new Set(merged[key].fragmentRefs);
                        const newRefs = source[key].fragmentRefs.filter(ref => !existingRefs.has(ref));
                        if (newRefs.length > 0) {
                            merged[key].fragmentRefs = [...merged[key].fragmentRefs, ...newRefs];
                        }
                    }
                } else {
                    merged[key] = source[key];
                }
            }
        }
        return merged;
    }

    private getTypeNodeByPath(typeTree: TypeTree, path: Array<string | number>): TypeTreeNode | undefined {
        let targetNode: TypeTreeNode | undefined = typeTree.operation;
        for (const segment of path) {
            if (Number.isNaN(Number.parseInt(segment as string, 10))) {
                if (targetNode) {
                    let children: { [name: string]: TypeTreeNode } = targetNode.children;
                    if (targetNode.fragmentRefs.length) {
                        const fragmentRefs = targetNode.fragmentRefs.slice();
                        while (fragmentRefs.length) {
                            const ref = fragmentRefs.pop();
                            if (ref) {
                                const fragment = typeTree.fragments[ref];
                                if (fragment) {
                                    // Deeply merge the children
                                    children = this.deepMergeChildren(children, fragment.children);
                                    if (fragment.fragmentRefs) {
                                        fragmentRefs.push(...fragment.fragmentRefs);
                                    }
                                }
                            }
                        }
                    }
                    targetNode = children[segment];
                }
            }
        }
        return targetNode;
    }

    private traverse(
        o: { [key: string]: any },
        visitorFn: (key: string, value: any, path: Array<string | number>) => any,
        path: Array<string | number> = [],
    ) {
        for (const key of Object.keys(o)) {
            path.push(key);
            o[key] = visitorFn(key, o[key], path);
            if (o[key] !== null && typeof o[key] === 'object') {
                this.traverse(o[key], visitorFn, path);
            }
            path.pop();
        }
    }

    private isTypeTree(input: TypeTree | TypeTreeNode): input is TypeTree {
        return input.hasOwnProperty('fragments');
    }
}
