// The entries of the last resolved navigation menu, shown until the
// permissions load. They belong to the administrator who saw them, so logout
// forgets them.
const REMEMBERED_NAV_KEY = 'vendure-dashboard:nav-menu-entries';

export function readRememberedNavEntries(): string[] | null {
    try {
        const stored = JSON.parse(localStorage.getItem(REMEMBERED_NAV_KEY) ?? 'null');
        return Array.isArray(stored) && stored.every(id => typeof id === 'string') ? stored : null;
    } catch {
        return null;
    }
}

export function rememberNavEntries(ids: string[]) {
    try {
        localStorage.setItem(REMEMBERED_NAV_KEY, JSON.stringify(ids));
    } catch {
        // Storage can be full or blocked.
    }
}

export function forgetRememberedNavEntries() {
    try {
        localStorage.removeItem(REMEMBERED_NAV_KEY);
    } catch {
        // Storage can be blocked.
    }
}
