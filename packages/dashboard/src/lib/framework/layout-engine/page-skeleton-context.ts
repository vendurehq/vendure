import { createContext, useContext } from 'react';

/**
 * True inside the skeleton of a page while its route loads. `PageLayout` then
 * draws the extension blocks registered for the page as skeleton cards, since
 * their components need the entity that is still loading.
 */
export const PageSkeletonContext = createContext(false);

export function useIsPageSkeleton() {
    return useContext(PageSkeletonContext);
}
