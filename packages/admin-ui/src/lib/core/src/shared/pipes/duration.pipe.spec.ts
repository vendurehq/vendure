import { DurationPipe } from './duration.pipe';

describe('DurationPipe', () => {
    let mockI18nService: any;
    beforeEach(() => {
        mockI18nService = {
            translate: jasmine.createSpy('translate'),
        };
    });

    it('ms', () => {
        const pipe = new DurationPipe(mockI18nService);

        pipe.transform(1);
        expect(mockI18nService.translate.calls.argsFor(0)).toEqual([
            'datetime.duration-milliseconds',
            { ms: 1 },
        ]);

        pipe.transform(999);
        expect(mockI18nService.translate.calls.argsFor(1)).toEqual([
            'datetime.duration-milliseconds',
            { ms: 999 },
        ]);
    });

    it('s', () => {
        const pipe = new DurationPipe(mockI18nService);

        pipe.transform(1000);
        expect(mockI18nService.translate.calls.argsFor(0)).toEqual(['datetime.duration-seconds', { s: 1.0 }]);

        pipe.transform(2567);
        expect(mockI18nService.translate.calls.argsFor(1)).toEqual(['datetime.duration-seconds', { s: 2.6 }]);

        pipe.transform(59.3 * 1000);
        expect(mockI18nService.translate.calls.argsFor(2)).toEqual([
            'datetime.duration-seconds',
            { s: 59.3 },
        ]);
    });

    it('m:s', () => {
        const pipe = new DurationPipe(mockI18nService);

        pipe.transform(60 * 1000);
        expect(mockI18nService.translate.calls.argsFor(0)).toEqual([
            'datetime.duration-minutes:seconds',
            { m: 1, s: '00' },
        ]);

        pipe.transform(125.23 * 1000);
        expect(mockI18nService.translate.calls.argsFor(1)).toEqual([
            'datetime.duration-minutes:seconds',
            { m: 2, s: '05' },
        ]);
    });
});
