import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity, Column, Index, ManyToOne } from 'typeorm';

import { ApiType } from '../../api/common/get-api-type';
import { User } from '../user/user.entity';

import { Session } from './session.entity';

/**
 * @description
 * An AuthenticatedSession is created upon successful authentication.
 *
 * @docsCategory entities
 */
@ChildEntity()
export class AuthenticatedSession extends Session {
    constructor(input: DeepPartial<AuthenticatedSession>) {
        super(input);
    }

    /**
     * @description
     * The {@link User} who has authenticated to create this session.
     */
    @Index()
    @ManyToOne(type => User, user => user.sessions)
    user: User;

    /**
     * @description
     * The name of the {@link AuthenticationStrategy} used when authenticating
     * to create this session.
     */
    @Column()
    authenticationStrategy: string;

    /**
     * @description
     * The API on which this session was created. The AuthGuard only accepts a session on the Admin API
     * if it was created there, so an AuthenticationStrategy which is shared between the Shop and Admin
     * APIs cannot be used to mint an administrator session from the storefront.
     *
     * Null for sessions created before this column existed. Those are not accepted on the Admin API,
     * so administrators must log in again after upgrading.
     *
     * @since 3.8.0
     */
    @Column({ type: 'varchar', nullable: true })
    apiType: ApiType | null;
}
