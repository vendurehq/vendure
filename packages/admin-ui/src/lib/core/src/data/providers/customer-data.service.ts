import * as Codegen from '../../common/generated-types';
import { LogicalOperator } from '../../common/generated-types';
import {
    ADD_CUSTOMERS_TO_GROUP,
    ADD_NOTE_TO_CUSTOMER,
    CREATE_CUSTOMER,
    CREATE_CUSTOMER_ADDRESS,
    CREATE_CUSTOMER_GROUP,
    DELETE_CUSTOMER,
    DELETE_CUSTOMER_ADDRESS,
    DELETE_CUSTOMER_GROUP,
    DELETE_CUSTOMER_GROUPS,
    DELETE_CUSTOMER_NOTE,
    DELETE_CUSTOMERS,
    GET_CUSTOMER_GROUP_WITH_CUSTOMERS,
    GET_CUSTOMER_GROUPS,
    GET_CUSTOMER_HISTORY,
    GET_CUSTOMER_LIST,
    REMOVE_CUSTOMERS_FROM_GROUP,
    UPDATE_CUSTOMER,
    UPDATE_CUSTOMER_ADDRESS,
    UPDATE_CUSTOMER_GROUP,
    UPDATE_CUSTOMER_NOTE,
} from '../definitions/customer-definitions';

import { BaseDataService } from './base-data.service';

export class CustomerDataService {
    constructor(private baseDataService: BaseDataService) {}

    getCustomerList(take = 10, skip = 0, filterTerm?: string) {
        const filter = filterTerm
            ? {
                  filter: {
                      emailAddress: {
                          contains: filterTerm,
                      },
                      lastName: {
                          contains: filterTerm,
                      },
                  },
              }
            : {};
        return this.baseDataService.query<
            Codegen.GetCustomerListQuery,
            Codegen.GetCustomerListQueryVariables
        >(GET_CUSTOMER_LIST, {
            options: {
                take,
                skip,
                ...filter,
                filterOperator: LogicalOperator.OR,
            },
        });
    }

    createCustomer(input: Codegen.CreateCustomerInput, password?: string | null) {
        return this.baseDataService.mutate<
            Codegen.CreateCustomerMutation,
            Codegen.CreateCustomerMutationVariables
        >(CREATE_CUSTOMER, {
            input,
            password,
        });
    }

    updateCustomer(input: Codegen.UpdateCustomerInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateCustomerMutation,
            Codegen.UpdateCustomerMutationVariables
        >(UPDATE_CUSTOMER, {
            input,
        });
    }

    deleteCustomer(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteCustomerMutation,
            Codegen.DeleteCustomerMutationVariables
        >(DELETE_CUSTOMER, { id });
    }

    deleteCustomers(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteCustomersMutation,
            Codegen.DeleteCustomersMutationVariables
        >(DELETE_CUSTOMERS, { ids });
    }

    createCustomerAddress(customerId: string, input: Codegen.CreateAddressInput) {
        return this.baseDataService.mutate<
            Codegen.CreateCustomerAddressMutation,
            Codegen.CreateCustomerAddressMutationVariables
        >(CREATE_CUSTOMER_ADDRESS, {
            customerId,
            input,
        });
    }

    updateCustomerAddress(input: Codegen.UpdateAddressInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateCustomerAddressMutation,
            Codegen.UpdateCustomerAddressMutationVariables
        >(UPDATE_CUSTOMER_ADDRESS, {
            input,
        });
    }

    deleteCustomerAddress(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteCustomerAddressMutation,
            Codegen.DeleteCustomerAddressMutationVariables
        >(DELETE_CUSTOMER_ADDRESS, { id });
    }

    createCustomerGroup(input: Codegen.CreateCustomerGroupInput) {
        return this.baseDataService.mutate<
            Codegen.CreateCustomerGroupMutation,
            Codegen.CreateCustomerGroupMutationVariables
        >(CREATE_CUSTOMER_GROUP, {
            input,
        });
    }

    updateCustomerGroup(input: Codegen.UpdateCustomerGroupInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateCustomerGroupMutation,
            Codegen.UpdateCustomerGroupMutationVariables
        >(UPDATE_CUSTOMER_GROUP, {
            input,
        });
    }

    deleteCustomerGroup(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteCustomerGroupMutation,
            Codegen.DeleteCustomerGroupMutationVariables
        >(DELETE_CUSTOMER_GROUP, { id });
    }

    deleteCustomerGroups(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteCustomerGroupsMutation,
            Codegen.DeleteCustomerGroupsMutationVariables
        >(DELETE_CUSTOMER_GROUPS, { ids });
    }

    getCustomerGroupList(options?: Codegen.CustomerGroupListOptions) {
        return this.baseDataService.query<
            Codegen.GetCustomerGroupsQuery,
            Codegen.GetCustomerGroupsQueryVariables
        >(GET_CUSTOMER_GROUPS, {
            options,
        });
    }

    getCustomerGroupWithCustomers(id: string, options: Codegen.CustomerListOptions) {
        return this.baseDataService.query<
            Codegen.GetCustomerGroupWithCustomersQuery,
            Codegen.GetCustomerGroupWithCustomersQueryVariables
        >(GET_CUSTOMER_GROUP_WITH_CUSTOMERS, {
            id,
            options,
        });
    }

    addCustomersToGroup(groupId: string, customerIds: string[]) {
        return this.baseDataService.mutate<
            Codegen.AddCustomersToGroupMutation,
            Codegen.AddCustomersToGroupMutationVariables
        >(ADD_CUSTOMERS_TO_GROUP, {
            groupId,
            customerIds,
        });
    }

    removeCustomersFromGroup(groupId: string, customerIds: string[]) {
        return this.baseDataService.mutate<
            Codegen.RemoveCustomersFromGroupMutation,
            Codegen.RemoveCustomersFromGroupMutationVariables
        >(REMOVE_CUSTOMERS_FROM_GROUP, {
            groupId,
            customerIds,
        });
    }

    getCustomerHistory(id: string, options?: Codegen.HistoryEntryListOptions) {
        return this.baseDataService.query<
            Codegen.GetCustomerHistoryQuery,
            Codegen.GetCustomerHistoryQueryVariables
        >(GET_CUSTOMER_HISTORY, {
            id,
            options,
        });
    }

    addNoteToCustomer(customerId: string, note: string) {
        return this.baseDataService.mutate<
            Codegen.AddNoteToCustomerMutation,
            Codegen.AddNoteToCustomerMutationVariables
        >(ADD_NOTE_TO_CUSTOMER, {
            input: {
                note,
                isPublic: false,
                id: customerId,
            },
        });
    }

    updateCustomerNote(input: Codegen.UpdateCustomerNoteInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateCustomerNoteMutation,
            Codegen.UpdateCustomerNoteMutationVariables
        >(UPDATE_CUSTOMER_NOTE, {
            input,
        });
    }

    deleteCustomerNote(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteCustomerNoteMutation,
            Codegen.DeleteCustomerNoteMutationVariables
        >(DELETE_CUSTOMER_NOTE, {
            id,
        });
    }
}
