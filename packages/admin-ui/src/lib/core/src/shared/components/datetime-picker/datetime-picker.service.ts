import { Injectable } from '@angular/core';
import dayjs from 'dayjs';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { dayOfWeekIndex } from './constants';
import { CalendarView, DayCell, DayOfWeek } from './types';

@Injectable()
export class DatetimePickerService {
    calendarView$: Observable<CalendarView>;
    selected$: Observable<Date | null>;
    viewing$: Observable<Date>;
    private selectedDatetime$ = new BehaviorSubject<dayjs.Dayjs | null>(null);
    private viewingDatetime$ = new BehaviorSubject<dayjs.Dayjs>(dayjs());
    private weekStartDayIndex: number;
    private min: dayjs.Dayjs | null = null;
    private max: dayjs.Dayjs | null = null;
    private jumping = false;

    constructor() {
        this.selected$ = this.selectedDatetime$.pipe(
            map(value => value && value.toDate()),
            distinctUntilChanged((a, b) => a?.getTime() === b?.getTime()),
        );
        this.viewing$ = this.viewingDatetime$.pipe(map(value => value.toDate()));
        this.weekStartDayIndex = dayOfWeekIndex['mon'];
        this.calendarView$ = combineLatest(this.viewingDatetime$, this.selectedDatetime$).pipe(
            map(([viewing, selected]) => this.generateCalendarView(viewing, selected)),
        );
    }

    setWeekStartingDay(weekStartDay: DayOfWeek) {
        this.weekStartDayIndex = dayOfWeekIndex[weekStartDay];
    }

    setMin(min?: string | null) {
        if (typeof min === 'string') {
            this.min = dayjs(min);
        }
    }

    setMax(max?: string | null) {
        if (typeof max === 'string') {
            this.max = dayjs(max);
        }
    }

    selectDatetime(date: Date | string | dayjs.Dayjs | null) {
        let viewingValue: dayjs.Dayjs;
        let selectedValue: dayjs.Dayjs | null = null;
        if (date == null || date === '') {
            viewingValue = dayjs();
        } else {
            viewingValue = dayjs(date);
            selectedValue = dayjs(date);
        }

        this.selectedDatetime$.next(selectedValue);
        this.viewingDatetime$.next(viewingValue);
    }

    selectHour(hourOfDay: number) {
        const current = this.selectedDatetime$.value || dayjs();
        const next = current.hour(hourOfDay);
        this.selectedDatetime$.next(next);
        this.viewingDatetime$.next(next);
    }

    selectMinute(minutePastHour: number) {
        const current = this.selectedDatetime$.value || dayjs();
        const next = current.minute(minutePastHour);
        this.selectedDatetime$.next(next);
        this.viewingDatetime$.next(next);
    }

    viewNextMonth() {
        this.jumping = false;
        const current = this.viewingDatetime$.value;
        this.viewingDatetime$.next(current.add(1, 'month'));
    }

    viewPrevMonth() {
        this.jumping = false;
        const current = this.viewingDatetime$.value;
        this.viewingDatetime$.next(current.subtract(1, 'month'));
    }

    viewToday() {
        this.jumping = false;
        this.viewingDatetime$.next(dayjs());
    }

    viewJumpDown() {
        this.jumping = true;
        const current = this.viewingDatetime$.value;
        this.viewingDatetime$.next(current.add(1, 'week'));
    }

    viewJumpUp() {
        this.jumping = true;
        const current = this.viewingDatetime$.value;
        this.viewingDatetime$.next(current.subtract(1, 'week'));
    }

    viewJumpRight() {
        this.jumping = true;
        const current = this.viewingDatetime$.value;
        this.viewingDatetime$.next(current.add(1, 'day'));
    }

    viewJumpLeft() {
        this.jumping = true;
        const current = this.viewingDatetime$.value;
        this.viewingDatetime$.next(current.subtract(1, 'day'));
    }

    selectToday() {
        this.jumping = false;
        this.selectDatetime(dayjs());
    }

    selectViewed() {
        this.jumping = false;
        this.selectDatetime(this.viewingDatetime$.value);
    }

    viewMonth(month: number) {
        this.jumping = false;
        const current = this.viewingDatetime$.value;
        this.viewingDatetime$.next(current.month(month - 1));
    }

    viewYear(year: number) {
        this.jumping = false;
        const current = this.viewingDatetime$.value;
        this.viewingDatetime$.next(current.year(year));
    }

    private generateCalendarView(viewing: dayjs.Dayjs, selected: dayjs.Dayjs | null): CalendarView {
        if (!viewing.isValid() || (selected && !selected.isValid())) {
            return [];
        }
        const start = viewing.startOf('month');
        const end = viewing.endOf('month');
        const today = dayjs();
        const daysInMonth = viewing.daysInMonth();
        const selectedDayOfMonth = selected && selected.get('date');

        const startDayOfWeek = start.day();
        const startIndex = (7 + (startDayOfWeek - this.weekStartDayIndex)) % 7;

        const calendarView: CalendarView = [];
        let week: DayCell[] = [];

        // Add the days at the tail of the previous month
        if (0 < startIndex) {
            const prevMonth = viewing.subtract(1, 'month');
            const daysInPrevMonth = prevMonth.daysInMonth();
            const prevIsCurrentMonth = prevMonth.isSame(today, 'month');
            for (let i = daysInPrevMonth - startIndex + 1; i <= daysInPrevMonth; i++) {
                const thisDay = viewing.subtract(1, 'month').date(i);
                week.push({
                    dayOfMonth: i,
                    selected: false,
                    inCurrentMonth: false,
                    isToday: prevIsCurrentMonth && today.get('date') === i,
                    isViewing: false,
                    disabled: !this.isInBounds(thisDay),
                    select: () => {
                        this.selectDatetime(thisDay);
                    },
                });
            }
        }

        // Add this month's days
        const isCurrentMonth = viewing.isSame(today, 'month');
        for (let i = 1; i <= daysInMonth; i++) {
            if ((i + startIndex - 1) % 7 === 0) {
                calendarView.push(week);
                week = [];
            }
            const thisDay = start.add(i - 1, 'day');
            const isViewingThisMonth =
                !!selected && selected.isSame(viewing, 'month') && selected.isSame(viewing, 'year');
            week.push({
                dayOfMonth: i,
                selected: i === selectedDayOfMonth && isViewingThisMonth,
                inCurrentMonth: true,
                isToday: isCurrentMonth && today.get('date') === i,
                isViewing: this.jumping && viewing.date() === i,
                disabled: !this.isInBounds(thisDay),
                select: () => {
                    this.selectDatetime(thisDay);
                },
            });
        }

        // Add the days at the start of the next month
        const emptyCellsEnd = 7 - ((startIndex + daysInMonth) % 7);
        if (emptyCellsEnd !== 7) {
            const nextMonth = viewing.add(1, 'month');
            const nextIsCurrentMonth = nextMonth.isSame(today, 'month');

            for (let i = 1; i <= emptyCellsEnd; i++) {
                const thisDay = end.add(i, 'day');
                week.push({
                    dayOfMonth: i,
                    selected: false,
                    inCurrentMonth: false,
                    isToday: nextIsCurrentMonth && today.get('date') === i,
                    isViewing: false,
                    disabled: !this.isInBounds(thisDay),
                    select: () => {
                        this.selectDatetime(thisDay);
                    },
                });
            }
        }
        calendarView.push(week);
        return calendarView;
    }

    private isInBounds(date: dayjs.Dayjs): boolean {
        if (this.min && this.min.isAfter(date)) {
            return false;
        }
        if (this.max && this.max.isBefore(date)) {
            return false;
        }
        return true;
    }
}
