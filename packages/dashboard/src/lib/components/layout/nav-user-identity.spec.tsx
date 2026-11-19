import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NavUserIdentity } from './nav-user-identity.js';

const user = {
    firstName: 'Super',
    lastName: 'Admin',
    emailAddress: 'superadmin',
    avatar: null,
};

describe('NavUserIdentity', () => {
    it('renders the round avatar of a person', () => {
        const markup = renderToStaticMarkup(<NavUserIdentity user={user} />);

        expect(markup).toContain('data-shape="circle"');
    });

    it('uses the interface font for the user identifier', () => {
        const markup = renderToStaticMarkup(<NavUserIdentity user={user} />);

        expect(markup).not.toContain('font-mono');
    });
});
