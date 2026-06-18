import { arrayToTree, HasParent, RootNode, TreeNode } from './array-to-tree';

describe('arrayToTree()', () => {
    it('preserves ordering', () => {
        const result1 = arrayToTree([
            { id: '13', parent: { id: '1' } },
            { id: '12', parent: { id: '1' } },
        ]);
        expect(result1.children.map(i => i.id)).toEqual(['13', '12']);

        const result2 = arrayToTree([
            { id: '12', parent: { id: '1' } },
            { id: '13', parent: { id: '1' } },
        ]);
        expect(result2.children.map(i => i.id)).toEqual(['12', '13']);
    });

    it('converts an array to a tree', () => {
        const input: HasParent[] = [
            { id: '12', parent: { id: '1' } },
            { id: '13', parent: { id: '1' } },
            { id: '132', parent: { id: '13' } },
            { id: '131', parent: { id: '13' } },
            { id: '1211', parent: { id: '121' } },
            { id: '121', parent: { id: '12' } },
        ];

        const result = arrayToTree(input);
        expect(result).toEqual({
            id: '1',
            children: [
                {
                    id: '12',
                    parent: { id: '1' },
                    expanded: false,
                    children: [
                        {
                            id: '121',
                            parent: { id: '12' },
                            expanded: false,
                            children: [{ id: '1211', expanded: false, parent: { id: '121' }, children: [] }],
                        },
                    ],
                },
                {
                    id: '13',
                    parent: { id: '1' },
                    expanded: false,
                    children: [
                        { id: '132', expanded: false, parent: { id: '13' }, children: [] },
                        { id: '131', expanded: false, parent: { id: '13' }, children: [] },
                    ],
                },
            ],
        });
    });

    it('preserves expanded state from existing RootNode', () => {
        const existing: RootNode<TreeNode<any>> = {
            id: '1',
            children: [
                {
                    id: '12',
                    parent: { id: '1' },
                    expanded: false,
                    children: [
                        {
                            id: '121',
                            parent: { id: '12' },
                            expanded: false,
                            children: [{ id: '1211', expanded: false, parent: { id: '121' }, children: [] }],
                        },
                    ],
                },
                {
                    id: '13',
                    parent: { id: '1' },
                    expanded: true,
                    children: [
                        { id: '132', expanded: true, parent: { id: '13' }, children: [] },
                        { id: '131', expanded: false, parent: { id: '13' }, children: [] },
                    ],
                },
            ],
        };

        const input: HasParent[] = [
            { id: '12', parent: { id: '1' } },
            { id: '13', parent: { id: '1' } },
            { id: '132', parent: { id: '13' } },
            { id: '131', parent: { id: '13' } },
            { id: '1211', parent: { id: '121' } },
            { id: '121', parent: { id: '12' } },
        ];

        const result = arrayToTree(input, existing);

        expect(result).toEqual(existing);
    });
});
