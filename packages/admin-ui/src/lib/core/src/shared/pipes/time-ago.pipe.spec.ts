import { TimeAgoPipe } from './time-ago.pipe';

describe('TimeAgoPipe', () => {
    let mockI18nService: any;
    beforeEach(() => {
        mockI18nService = {
            translate: jasmine.createSpy('translate'),
        };
    });

    it('seconds ago', () => {
        const pipe = new TimeAgoPipe(mockI18nService);

        pipe.transform('2020-02-04T16:15:10.100Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(0)).toEqual(['datetime.ago-seconds', { count: 0 }]);

        pipe.transform('2020-02-04T16:15:07.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(1)).toEqual(['datetime.ago-seconds', { count: 3 }]);

        pipe.transform('2020-02-04T16:14:20.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(2)).toEqual(['datetime.ago-seconds', { count: 50 }]);
    });

    it('minutes ago', () => {
        const pipe = new TimeAgoPipe(mockI18nService);

        pipe.transform('2020-02-04T16:13:10.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(0)).toEqual(
            ['datetime.ago-minutes', { count: 2 }],
            'a',
        );

        pipe.transform('2020-02-04T16:12:10.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(1)).toEqual(
            ['datetime.ago-minutes', { count: 3 }],
            'b',
        );

        pipe.transform('2020-02-04T15:20:10.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(2)).toEqual(
            ['datetime.ago-minutes', { count: 55 }],
            'c',
        );
    });

    it('hours ago', () => {
        const pipe = new TimeAgoPipe(mockI18nService);

        pipe.transform('2020-02-04T14:15:10.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(0)).toEqual(['datetime.ago-hours', { count: 2 }]);

        pipe.transform('2020-02-04T02:15:07.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(1)).toEqual(['datetime.ago-hours', { count: 14 }]);

        pipe.transform('2020-02-03T17:14:20.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(2)).toEqual(['datetime.ago-hours', { count: 23 }]);
    });

    it('days ago', () => {
        const pipe = new TimeAgoPipe(mockI18nService);

        pipe.transform('2020-02-03T16:15:10.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(0)).toEqual(['datetime.ago-days', { count: 1 }]);

        pipe.transform('2020-02-01T02:15:07.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(1)).toEqual(['datetime.ago-days', { count: 3 }]);

        pipe.transform('2020-01-03T17:14:20.500Z', '2020-02-04T16:15:10.500Z');
        expect(mockI18nService.translate.calls.argsFor(2)).toEqual(['datetime.ago-days', { count: 31 }]);
    });

    it('years ago', () => {
        const pipe = new TimeAgoPipe(mockI18nService);

        pipe.transform('2019-02-04T12:00:00.000Z', '2020-02-04T12:00:00.000Z');
        expect(mockI18nService.translate.calls.argsFor(0)).toEqual(['datetime.ago-years', { count: 1 }]);

        pipe.transform('2018-02-04T12:00:01.000Z', '2020-02-04T12:00:00.000Z');
        expect(mockI18nService.translate.calls.argsFor(1)).toEqual(['datetime.ago-years', { count: 1 }]);

        pipe.transform('2018-02-04T12:00:00.000Z', '2020-02-04T12:00:00.000Z');
        expect(mockI18nService.translate.calls.argsFor(2)).toEqual(['datetime.ago-years', { count: 2 }]);

        pipe.transform('2010-01-04T12:00:00.000Z', '2020-02-04T12:00:00.000Z');
        expect(mockI18nService.translate.calls.argsFor(3)).toEqual(['datetime.ago-years', { count: 10 }]);
    });
});
