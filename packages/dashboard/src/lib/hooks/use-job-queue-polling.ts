import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

const JOB_LOOKBACK_MS = 5000; // Look back 5 seconds to catch jobs created before mutation returned
const MAX_POLLING_TIMEOUT_MS = 30000;
const INITIAL_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 4000;
const STORAGE_KEY_PREFIX = 'job-queue-polling:';

interface StoredPollingState {
    startTime: string;
    expiresAt: number;
    /** The scope the state was written under; resume only happens when it matches the current scope. */
    scopeKey?: string;
}

const jobListForPollingDocument = graphql(`
    query JobListForPolling($options: JobListOptions) {
        jobs(options: $options) {
            items {
                id
                createdAt
                state
            }
            totalItems
        }
    }
`);

const getStoredState = (storageKey: string) => {
    try {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) {
            return JSON.parse(stored) as StoredPollingState;
        }
    } catch {
        // Ignore parsing errors
    }
    return null;
};
const setStoredState = (storageKey: string, state: StoredPollingState) =>
    sessionStorage.setItem(storageKey, JSON.stringify(state));
const clearStoredState = (storageKey: string) => sessionStorage.removeItem(storageKey);
/**
 * Clears the stored entry only if it was written by the polling run identified by `startTime`.
 * The storage key is shared per queue, so an unconditional clear could delete an entry written
 * by a different scope's polling run.
 */
const clearStoredStateIfOwned = (storageKey: string, startTime: string | null) => {
    if (startTime == null) return;
    const stored = getStoredState(storageKey);
    if (stored?.startTime === startTime) {
        clearStoredState(storageKey);
    }
};

/**
 * Hook to poll a job queue until jobs complete.
 * Waits for jobs created after polling starts to settle before calling onComplete.
 *
 * Polling state is persisted in sessionStorage under a constant per-queue key, so it
 * survives a page refresh while maintaining the correct time window for finding relevant jobs.
 *
 * Pass `scopeKey` (e.g. the current entity id) to bind the persisted state to a scope. The
 * stored payload records the scopeKey it was written under, and resume only happens when that
 * scopeKey matches the current one — so navigating between entities of the same page (which
 * does not remount this hook) never resumes another entity's polling. A non-matching entry is
 * left untouched and self-expires via the timeout window.
 *
 * Omit `scopeKey` (pass `undefined`) for transient flows without a stable identity, e.g. an
 * entity-creation page: polling then stays purely in-memory — it is never written to
 * sessionStorage and never resumed — so a later visit to the same page cannot resurrect it.
 *
 * Note: because the state is bound to a scopeKey, polling does NOT resume across a change
 * between two different scopes. The one exception is the transition from unscoped to a scope
 * while polling is in flight — that can only be the create -> created navigation (any real
 * entity has a scope), so the in-flight polling is adopted into the new scope and persisted
 * under it, preserving the in-progress indicator and completion callback for the new entity.
 */
export function useJobQueuePolling(queueName: string, onComplete: () => void, scopeKey?: string) {
    const storageKey = `${STORAGE_KEY_PREFIX}${queueName}`;
    const [isPolling, setIsPolling] = useState(false);
    const [pollCount, setPollCount] = useState(0);
    const startTimeRef = useRef<string | null>(null);
    const expiresAtRef = useRef<number | null>(null);
    const prevScopeKeyRef = useRef(scopeKey);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onCompleteRef = useRef(onComplete);

    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    // Reset polling state whenever the scope changes (e.g. navigating between entities without
    // a remount), then resume from persisted state only if it belongs to the current scope.
    useEffect(() => {
        const prevScopeKey = prevScopeKeyRef.current;
        prevScopeKeyRef.current = scopeKey;

        // Adopt in-flight unscoped polling into the new scope. A transition from unscoped to a
        // scope while polling is in flight can only be the create -> created navigation (any
        // real entity has a scope), so keep the polling running and persist it under the new
        // scope so a refresh can also resume it.
        if (prevScopeKey == null && scopeKey != null && startTimeRef.current != null) {
            if (expiresAtRef.current != null) {
                setStoredState(storageKey, {
                    startTime: startTimeRef.current,
                    expiresAt: expiresAtRef.current,
                    scopeKey,
                });
            }
            return;
        }

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        startTimeRef.current = null;
        expiresAtRef.current = null;
        setIsPolling(false);

        // Unscoped (transient) usage is in-memory only — never resume from storage.
        if (scopeKey == null) return;

        const stored = getStoredState(storageKey);
        if (!stored) return;

        if (Date.now() >= stored.expiresAt) {
            // Expired entry — clean it up.
            clearStoredState(storageKey);
            return;
        }
        if (stored.scopeKey !== scopeKey) {
            // Belongs to a different scope; leave it to self-expire.
            return;
        }

        startTimeRef.current = stored.startTime;
        expiresAtRef.current = stored.expiresAt;
        setPollCount(0);
        setIsPolling(true);

        const remainingTime = stored.expiresAt - Date.now();
        timeoutRef.current = setTimeout(() => {
            setIsPolling(false);
            startTimeRef.current = null;
            expiresAtRef.current = null;
            clearStoredStateIfOwned(storageKey, stored.startTime);
            onCompleteRef.current();
        }, remainingTime);
    }, [storageKey, scopeKey]);

    // Calculate exponential backoff interval
    const pollInterval = isPolling
        ? Math.min(INITIAL_POLL_INTERVAL_MS * Math.pow(1.75, pollCount), MAX_POLL_INTERVAL_MS)
        : false;

    const { data: jobsData } = useQuery({
        queryKey: ['jobQueuePolling', queueName, scopeKey],
        queryFn: () => {
            setPollCount(c => c + 1);
            return api.query(jobListForPollingDocument, {
                options: {
                    filter: { queueName: { eq: queueName } },
                    sort: { createdAt: 'DESC' as const },
                    take: 10,
                },
            });
        },
        enabled: isPolling,
        refetchInterval: pollInterval,
    });

    // Detect job completion
    useEffect(() => {
        const startTime = startTimeRef.current;
        if (!isPolling || !startTime) return;

        const relevantJobs = jobsData?.jobs.items.filter(j => j.createdAt >= startTime) ?? [];
        const hasSettledJob =
            relevantJobs.length > 0 &&
            relevantJobs.every(j => j.state !== 'PENDING' && j.state !== 'RUNNING' && j.state !== 'RETRYING');

        if (hasSettledJob) {
            setIsPolling(false);
            startTimeRef.current = null;
            expiresAtRef.current = null;
            clearStoredStateIfOwned(storageKey, startTime);
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            onCompleteRef.current();
        }
    }, [jobsData, isPolling, storageKey]);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const startPolling = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        const startTime = new Date(Date.now() - JOB_LOOKBACK_MS).toISOString();
        const expiresAt = Date.now() + MAX_POLLING_TIMEOUT_MS;

        // Persist (with the current scope) so polling can resume after a refresh. Unscoped
        // (transient) usage stays in-memory only, so it can never resurrect on a later visit.
        if (scopeKey != null) {
            setStoredState(storageKey, { startTime, expiresAt, scopeKey });
        }

        startTimeRef.current = startTime;
        expiresAtRef.current = expiresAt;
        setPollCount(0);
        setIsPolling(true);

        timeoutRef.current = setTimeout(() => {
            setIsPolling(false);
            startTimeRef.current = null;
            expiresAtRef.current = null;
            clearStoredStateIfOwned(storageKey, startTime);
            onCompleteRef.current();
        }, MAX_POLLING_TIMEOUT_MS);
    }, [storageKey, scopeKey]);

    return { isPolling, startPolling };
}
