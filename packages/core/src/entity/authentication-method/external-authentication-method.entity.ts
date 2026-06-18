import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity, Column } from 'typeorm';

import { AuthenticationMethod } from './authentication-method.entity';

/**
 * @description
 * This method is used when an external authentication service is used to authenticate Vendure Users.
 * Examples of external auth include social logins or corporate identity servers.
 *
 * @docsCategory entities
 * @docsPage AuthenticationMethod
 */
@ChildEntity()
export class ExternalAuthenticationMethod extends AuthenticationMethod {
    constructor(input: DeepPartial<ExternalAuthenticationMethod>) {
        super(input);
    }

    @Column()
    strategy: string;

    @Column()
    externalIdentifier: string;

    @Column('simple-json')
    metadata: any;
}
