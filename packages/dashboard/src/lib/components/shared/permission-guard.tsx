import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { Permission } from '@vendure/common/lib/generated-types';

/**
 * @description
 * The props for the PermissionGuard component.
 *
 * @docsCategory components
 * @docsPage PermissionGuard
 * @since 3.4.0
 */
export interface PermissionGuardProps {
    /**
     * @description
     * The permission(s) required to access the children.
     */
    requires: Permission | string | string[] | Permission[];
    /**
     * @description
     * The children to render if the user has the required permissions.
     */
    children: React.ReactNode;
}

/**
 * @description
 * This component is used to protect a route from unauthorized access.
 * It will render the children if the user has the required permissions.
 * 
 * @example
 * ```tsx
 * <PermissionGuard requires={['UpdateTaxCategory']}>
 *     <Button type="submit">
 *         <Trans>Update</Trans>
 *     </Button>
 * </PermissionGuard>
 * ```
 * 
 * @docsCategory components
 * @docsPage PermissionGuard
 * @docsWeight 0
 * @since 3.4.0
 */
export function PermissionGuard({ requires, children }: Readonly<PermissionGuardProps>) {
    const { hasPermissions } = usePermissions();
    const permissions = Array.isArray(requires) ? requires : [requires];
    if (!hasPermissions(permissions)) {
        return null;
    }
    return children;
}
