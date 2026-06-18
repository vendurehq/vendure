import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ElementRef,
    Input,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Observable, Subscription } from 'rxjs';
import { map, tap } from 'rxjs/operators';

import { DropdownComponent } from '../dropdown/dropdown.component';

import { dayOfWeekIndex, weekDayNames } from './constants';
import { DatetimePickerService } from './datetime-picker.service';
import { CalendarView, DayCell, DayOfWeek } from './types';

export type CurrentView = {
    date: Date;
    month: number;
    year: number;
};

/**
 * @description
 * A form input for selecting datetime values.
 *
 * @example
 * ```HTML
 * <vdr-datetime-picker [(ngModel)]="startDate"></vdr-datetime-picker>
 * ```
 *
 * @docsCategory components
 */
@Component({
    selector: 'vdr-datetime-picker',
    templateUrl: './datetime-picker.component.html',
    styleUrls: ['./datetime-picker.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        DatetimePickerService,
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: DatetimePickerComponent,
            multi: true,
        },
    ],
    standalone: false,
})
export class DatetimePickerComponent implements ControlValueAccessor, AfterViewInit, OnInit, OnDestroy {
    /**
     * @description
     * The range above and below the current year which is selectable from
     * the year select control. If a min or max value is set, these will
     * override the yearRange.
     */
    @Input() yearRange;
    /**
     * @description
     * The day that the week should start with in the calendar view.
     */
    @Input() weekStartDay: DayOfWeek = 'mon';
    /**
     * @description
     * The granularity of the minutes time picker
     */
    @Input() timeGranularityInterval = 5;
    /**
     * @description
     * The minimum date as an ISO string
     */
    @Input() min: string | null = null;
    /**
     * @description
     * The maximum date as an ISO string
     */
    @Input() max: string | null = null;
    /**
     * @description
     * Sets the readonly state
     */
    @Input() readonly = false;

    @ViewChild('dropdownComponent', { static: true }) dropdownComponent: DropdownComponent;
    @ViewChild('datetimeInput', { static: true }) datetimeInput: ElementRef<HTMLInputElement>;
    @ViewChild('calendarTable') calendarTable: ElementRef<HTMLTableElement>;

    disabled = false;
    calendarView$: Observable<CalendarView>;
    current$: Observable<CurrentView>;
    selected$: Observable<Date | null>;
    selectedHours$: Observable<number | null>;
    selectedMinutes$: Observable<number | null>;
    years: number[];
    weekdays: string[] = [];
    hours: number[];
    minutes: number[];
    private onChange: (val: any) => void;
    private onTouch: () => void;
    private subscription: Subscription;

    constructor(
        private changeDetectorRef: ChangeDetectorRef,
        private datetimePickerService: DatetimePickerService,
    ) {}

    ngOnInit() {
        this.datetimePickerService.setWeekStartingDay(this.weekStartDay);
        this.datetimePickerService.setMin(this.min);
        this.datetimePickerService.setMax(this.max);
        this.populateYearsSelection();
        this.populateWeekdays();
        this.populateHours();
        this.populateMinutes();
        this.calendarView$ = this.datetimePickerService.calendarView$;
        this.current$ = this.datetimePickerService.viewing$.pipe(
            map(date => ({
                date,
                month: date.getMonth() + 1,
                year: date.getFullYear(),
            })),
        );
        this.selected$ = this.datetimePickerService.selected$;
        this.selectedHours$ = this.selected$.pipe(map(date => date && date.getHours()));
        this.selectedMinutes$ = this.selected$.pipe(map(date => date && date.getMinutes()));
        this.subscription = this.datetimePickerService.selected$.subscribe(val => {
            if (this.onChange) {
                this.onChange(val == null ? val : val.toISOString());
            }
        });
    }

    ngAfterViewInit(): void {
        this.dropdownComponent.onOpenChange(isOpen => {
            if (isOpen) {
                this.calendarTable.nativeElement.focus();
            }
        });
    }

    ngOnDestroy(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

    registerOnChange(fn: any) {
        this.onChange = fn;
    }

    registerOnTouched(fn: any) {
        this.onTouch = fn;
    }

    setDisabledState(isDisabled: boolean) {
        this.disabled = isDisabled;
    }

    writeValue(value: string | null) {
        this.datetimePickerService.selectDatetime(value);
    }

    prevMonth() {
        this.datetimePickerService.viewPrevMonth();
    }

    nextMonth() {
        this.datetimePickerService.viewNextMonth();
    }

    selectToday() {
        this.datetimePickerService.selectToday();
    }

    setYear(event: Event) {
        const target = event.target as HTMLSelectElement;
        this.datetimePickerService.viewYear(parseInt(target.value, 10));
    }

    setMonth(event: Event) {
        const target = event.target as HTMLSelectElement;
        this.datetimePickerService.viewMonth(parseInt(target.value, 10));
    }

    selectDay(day: DayCell) {
        if (day.disabled) {
            return;
        }
        day.select();
    }

    clearValue() {
        this.datetimePickerService.selectDatetime(null);
    }

    handleCalendarKeydown(event: KeyboardEvent) {
        switch (event.key) {
            case 'ArrowDown':
                return this.datetimePickerService.viewJumpDown();
            case 'ArrowUp':
                return this.datetimePickerService.viewJumpUp();
            case 'ArrowRight':
                return this.datetimePickerService.viewJumpRight();
            case 'ArrowLeft':
                return this.datetimePickerService.viewJumpLeft();
            case 'Enter':
                return this.datetimePickerService.selectViewed();
        }
    }

    setHour(event: Event) {
        const target = event.target as HTMLSelectElement;
        this.datetimePickerService.selectHour(parseInt(target.value, 10));
    }

    setMinute(event: Event) {
        const target = event.target as HTMLSelectElement;
        this.datetimePickerService.selectMinute(parseInt(target.value, 10));
    }

    closeDatepicker() {
        this.dropdownComponent.toggleOpen();
        this.datetimeInput.nativeElement.focus();
    }

    private populateYearsSelection() {
        const yearRange = this.yearRange ?? 10;
        const currentYear = new Date().getFullYear();
        const min = (this.min && new Date(this.min).getFullYear()) || currentYear - yearRange;
        const max = (this.max && new Date(this.max).getFullYear()) || currentYear + yearRange;
        const spread = max - min + 1;
        this.years = Array.from({ length: spread }).map((_, i) => min + i);
    }

    private populateWeekdays() {
        const weekStartDayIndex = dayOfWeekIndex[this.weekStartDay];
        for (let i = 0; i < 7; i++) {
            this.weekdays.push(weekDayNames[(i + weekStartDayIndex + 0) % 7]);
        }
    }

    private populateHours() {
        this.hours = Array.from({ length: 24 }).map((_, i) => i);
    }

    private populateMinutes() {
        const minutes: number[] = [];
        for (let i = 0; i < 60; i += this.timeGranularityInterval) {
            minutes.push(i);
        }
        this.minutes = minutes;
    }
}
