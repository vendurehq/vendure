import { SortPipe } from './sort.pipe';

describe('SortPipe', () => {
    const sortPipe = new SortPipe();

    it('sorts a primitive array', () => {
        const input = [5, 4, 2, 3, 2, 7, 1];
        expect(sortPipe.transform(input)).toEqual([1, 2, 2, 3, 4, 5, 7]);
    });

    it('sorts an array of objects', () => {
        const input = [{ id: 3 }, { id: 1 }, { id: 9 }, { id: 2 }, { id: 4 }];
        expect(sortPipe.transform(input, 'id')).toEqual([
            { id: 1 },
            { id: 2 },
            { id: 3 },
            { id: 4 },
            { id: 9 },
        ]);
    });

    it('sorts a frozen array', () => {
        const input = Object.freeze([5, 4, 2, 3, 2, 7, 1]);
        expect(sortPipe.transform(input)).toEqual([1, 2, 2, 3, 4, 5, 7]);
    });
});
