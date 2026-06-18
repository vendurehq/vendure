import * as Codegen from '../../common/generated-types';
import {
    CREATE_ADMINISTRATOR,
    CREATE_ROLE,
    DELETE_ADMINISTRATOR,
    DELETE_ADMINISTRATORS,
    DELETE_ROLE,
    DELETE_ROLES,
    GET_ACTIVE_ADMINISTRATOR,
    GET_ROLES,
    UPDATE_ACTIVE_ADMINISTRATOR,
    UPDATE_ADMINISTRATOR,
    UPDATE_ROLE,
} from '../definitions/administrator-definitions';

import { BaseDataService } from './base-data.service';

export class AdministratorDataService {
    constructor(private baseDataService: BaseDataService) {}

    getActiveAdministrator() {
        return this.baseDataService.query<Codegen.GetActiveAdministratorQuery>(GET_ACTIVE_ADMINISTRATOR, {});
    }

    createAdministrator(input: Codegen.CreateAdministratorInput) {
        return this.baseDataService.mutate<
            Codegen.CreateAdministratorMutation,
            Codegen.CreateAdministratorMutationVariables
        >(CREATE_ADMINISTRATOR, { input });
    }

    updateAdministrator(input: Codegen.UpdateAdministratorInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateAdministratorMutation,
            Codegen.UpdateAdministratorMutationVariables
        >(UPDATE_ADMINISTRATOR, { input });
    }

    updateActiveAdministrator(input: Codegen.UpdateActiveAdministratorInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateActiveAdministratorMutation,
            Codegen.UpdateActiveAdministratorMutationVariables
        >(UPDATE_ACTIVE_ADMINISTRATOR, { input });
    }

    deleteAdministrator(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteAdministratorMutation,
            Codegen.DeleteAdministratorMutationVariables
        >(DELETE_ADMINISTRATOR, { id });
    }

    deleteAdministrators(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteAdministratorsMutation,
            Codegen.DeleteAdministratorsMutationVariables
        >(DELETE_ADMINISTRATORS, { ids });
    }

    getRoles(take = 10, skip = 0) {
        return this.baseDataService.query<Codegen.GetRolesQuery, Codegen.GetRolesQueryVariables>(GET_ROLES, {
            options: {
                take,
                skip,
            },
        });
    }

    createRole(input: Codegen.CreateRoleInput) {
        return this.baseDataService.mutate<Codegen.CreateRoleMutation, Codegen.CreateRoleMutationVariables>(
            CREATE_ROLE,
            {
                input,
            },
        );
    }

    updateRole(input: Codegen.UpdateRoleInput) {
        return this.baseDataService.mutate<Codegen.UpdateRoleMutation, Codegen.UpdateRoleMutationVariables>(
            UPDATE_ROLE,
            {
                input,
            },
        );
    }

    deleteRole(id: string) {
        return this.baseDataService.mutate<Codegen.DeleteRoleMutation, Codegen.DeleteRoleMutationVariables>(
            DELETE_ROLE,
            {
                id,
            },
        );
    }

    deleteRoles(ids: string[]) {
        return this.baseDataService.mutate<Codegen.DeleteRolesMutation, Codegen.DeleteRolesMutationVariables>(
            DELETE_ROLES,
            {
                ids,
            },
        );
    }
}
