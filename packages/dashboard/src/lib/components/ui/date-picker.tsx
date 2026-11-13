export { DatePicker, type DatePickerProps } from '@vendure-io/ui/components/molecules/date-picker';
// The raw v2 DateRangePicker molecule is NOT re-exported here: the dashboard's
// public `DateRangePicker` (components/date-range-picker.tsx) is the
// instant-valued wrapper over it, and exporting both would make the name
// ambiguous in the generated public index.
export {
    type DateRangePickerProps,
    type DateRangePreset,
    type DateRangeValue,
} from '@vendure-io/ui/components/molecules/date-range-picker';
export { DateTimePicker, type DateTimePickerProps } from '@vendure-io/ui/components/molecules/date-time-picker';
