import { LanguageCode } from '../../common/generated-types';

import { LocaleDatePipe } from './locale-date.pipe';

describe('LocaleDatePipe', () => {
    const testDate = new Date('2021-01-12T09:12:42');
    it('medium format', () => {
        const pipe = new LocaleDatePipe();
        expect(pipe.transform(testDate, 'medium', LanguageCode.en)).toBe('Jan 12, 2021, 9:12:42 AM');
    });
    it('mediumTime format', () => {
        const pipe = new LocaleDatePipe();
        expect(pipe.transform(testDate, 'mediumTime', LanguageCode.en)).toBe('9:12:42 AM');
    });
    it('short format', () => {
        const pipe = new LocaleDatePipe();
        expect(pipe.transform(testDate, 'short', LanguageCode.en)).toBe('1/12/21, 9:12 AM');
    });
    it('longDate format', () => {
        const pipe = new LocaleDatePipe();
        expect(pipe.transform(testDate, 'longDate', LanguageCode.en)).toBe('January 12, 2021');
    });

    it('medium format German', () => {
        const pipe = new LocaleDatePipe();
        expect(pipe.transform(testDate, 'medium', LanguageCode.de)).toBe('12. Jan. 2021, 09:12:42');
    });

    it('medium format Chinese', () => {
        const pipe = new LocaleDatePipe();
        expect(pipe.transform(testDate, 'medium', LanguageCode.zh)).toBe('2021年1月12日 09:12:42');
    });
});
