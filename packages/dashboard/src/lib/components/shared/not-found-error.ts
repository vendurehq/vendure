/**
 * @description
 * Thrown by route loaders (e.g. `detailPageRouteLoader`) when the requested
 * entity does not exist. The {@link ErrorPage} renders a dedicated not-found
 * state when it encounters this error kind. Lives in its own module so loaders
 * can throw it without pulling in the React component tree.
 */
export class NotFoundError extends Error {
    constructor(message = 'Not found') {
        super(message);
        this.name = 'NotFoundError';
    }
}
