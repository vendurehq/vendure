import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

import { InternalServerError } from '../../common/error/errors';
import { SoftDeletable } from '../../common/types/common-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { AuthenticationMethod } from '../authentication-method/authentication-method.entity';
import { NativeAuthenticationMethod } from '../authentication-method/native-authentication-method.entity';
import { VendureEntity } from '../base/base.entity';
import { CustomUserFields } from '../custom-entity-fields';
import { Role } from '../role/role.entity';
import { AuthenticatedSession } from '../session/authenticated-session.entity';

/**
 * @description
 * A User represents any authenticated user of the Vendure API. This includes both
 * {@link Administrator}s as well as registered {@link Customer}s.
 *
 * @docsCategory entities
 */
@Entity()
export class User extends VendureEntity implements HasCustomFields, SoftDeletable {
    constructor(input?: DeepPartial<User>) {
        super(input);
    }

    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    @Column()
    identifier: string;

    @OneToMany(type => AuthenticationMethod, method => method.user)
    authenticationMethods: AuthenticationMethod[];

    @Column({ default: false })
    verified: boolean;

    @ManyToMany(type => Role)
    @JoinTable()
    roles: Role[];

    @Column({ type: Date, nullable: true })
    lastLogin: Date | null;

    @Column(type => CustomUserFields)
    customFields: CustomUserFields;

    @OneToMany(type => AuthenticatedSession, session => session.user)
    sessions: AuthenticatedSession[];

    getNativeAuthenticationMethod(): NativeAuthenticationMethod;
    getNativeAuthenticationMethod(strict?: boolean): NativeAuthenticationMethod | undefined;

    getNativeAuthenticationMethod(strict?: boolean): NativeAuthenticationMethod | undefined {
        if (!this.authenticationMethods) {
            throw new InternalServerError('error.user-authentication-methods-not-loaded');
        }
        const match = this.authenticationMethods.find(
            (m): m is NativeAuthenticationMethod => m instanceof NativeAuthenticationMethod,
        );
        if (!match && (strict === undefined || strict)) {
            throw new InternalServerError('error.native-authentication-methods-not-found');
        }
        return match;
    }
}
