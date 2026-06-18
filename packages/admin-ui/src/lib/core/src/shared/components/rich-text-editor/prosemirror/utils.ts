import { MarkType, ResolvedPos } from 'prosemirror-model';

/**
 * Retrieve the start and end position of a mark
 * "Borrowed" from [tiptap](https://github.com/scrumpy/tiptap)
 */
export const getMarkRange = (
    pmPosition: ResolvedPos | null = null,
    type: MarkType | null | undefined = null,
): { from: number; to: number } | false => {
    if (!pmPosition || !type) {
        return false;
    }

    const start = pmPosition.parent.childAfter(pmPosition.parentOffset);

    if (!start.node) {
        return false;
    }

    const mark = start.node.marks.find(({ type: markType }) => markType === type);
    if (!mark) {
        return false;
    }

    let startIndex = pmPosition.index();
    let startPos = pmPosition.start() + start.offset;
    while (startIndex > 0 && mark.isInSet(pmPosition.parent.child(startIndex - 1).marks)) {
        startIndex -= 1;
        startPos -= pmPosition.parent.child(startIndex).nodeSize;
    }

    const endPos = startPos + start.node.nodeSize;

    return { from: startPos, to: endPos };
};
