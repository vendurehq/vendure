import {
    ASTVisitor,
    DocumentNode,
    getNamedType,
    GraphQLField,
    GraphQLInputObjectType,
    GraphQLNamedType,
    GraphQLSchema,
    isInputObjectType,
    isListType,
    isNonNullType,
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
    private argumentCache = new WeakMap<GraphQLField<unknown, unknown>, TypeTree>();
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
     * Constructs a tree of TypeTreeNodes for the arguments of a field, keyed by argument name.
     */
    getArgumentTypeTree(field: GraphQLField<unknown, unknown>): TypeTree {
        const cached = this.argumentCache.get(field);
        if (cached) {
            return cached;
        }
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
        for (const arg of field.args) {
            const inputType = getNamedType(arg.type);
            const argNode: TypeTreeNode = {
                type: inputType,
                isList: this.isList(arg.type),
                parent: rootNode,
                fragmentRefs: [],
                children: {},
            };
            if (isInputObjectType(inputType)) {
                argNode.children = this.getChildrenTreeNodes(inputType, argNode);
            }
            rootNode.children[arg.name] = argNode;
        }
        this.argumentCache.set(field, typeTree);
        return typeTree;
    }

    private getChildrenTreeNodes(
        inputType: GraphQLInputObjectType,
        parent: TypeTreeNode,
        ancestors: ReadonlySet<GraphQLInputObjectType> = new Set([inputType]),
        depth = 0,
    ): { [name: string]: TypeTreeNode } {
        if (depth > 3) return {};

        return Object.entries(inputType.getFields()).reduce(
            (result, [key, field]) => {
                const namedType = getNamedType(field.type);
                const child: TypeTreeNode = {
                    type: namedType,
                    isList: this.isList(field.type),
                    parent,
                    fragmentRefs: [],
                    children: {},
                };
                if (isInputObjectType(namedType)) {
                    // `ancestors` holds the input types on the path from the argument to this field.
                    // `depth` counts the fields on that path whose type was already in `ancestors`, and
                    // this method returns no children once `depth` exceeds 3. Input types can reference
                    // themselves or each other, as filter types do through `_and` and `_or`. Without the
                    // limit, expanding them recurses until the stack overflows. `getArgumentTypeTree()`
                    // builds the tree for every argument of the field, including arguments the client
                    // does not send, so the overflow would happen on every call. An ID nested deeper
                    // than the limit reaches the resolver encoded.
                    const isRepeat = ancestors.has(namedType);
                    child.children = this.getChildrenTreeNodes(
                        namedType,
                        child,
                        isRepeat ? ancestors : new Set([...ancestors, namedType]),
                        isRepeat ? depth + 1 : depth,
                    );
                }
                result[key] = child;
                return result;
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
