export { StatusBadge, statusBadgeVariants } from '@vendure-io/ui/components/molecules/status-badge';

// Re-export the state-dictionary contract so extensions can declare their own
// domain state maps (order states, job states, etc.) and drive a StatusBadge
// `tone` from them, exactly as the dashboard does internally.
export {
    commonStates,
    defineStateEntries,
    isProgressTone,
    maxTone,
    TONE_SEVERITY,
} from '@vendure-io/ui/lib/state-dictionary';
export type { StateEntry, StateMap, Tone } from '@vendure-io/ui/lib/state-dictionary';
