/**
 * This interface should be implemented by those top-level components which want to
 * signal to the user if a route deactivation is attempted in a state where chages
 * would be lost.
 */
export interface DeactivateAware {
    canDeactivate(): boolean;
}
