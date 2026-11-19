import { AdministratorAvatar } from '@/vdb/components/shared/administrator-avatar.js';
import { SidebarIdentityText } from '@vendure-io/ui/components/atoms/sidebar';

export interface NavUserIdentityProps {
    user: {
        firstName: string;
        lastName: string;
        emailAddress: string;
        avatar?: {
            preview: string;
        } | null;
    };
    showDetails?: boolean;
}

export function NavUserIdentity({ user, showDetails = true }: NavUserIdentityProps) {
    return (
        <>
            <AdministratorAvatar preview={user.avatar?.preview} name={`${user.firstName} ${user.lastName}`} />
            {showDetails ? (
                <SidebarIdentityText
                    title={`${user.firstName} ${user.lastName}`}
                    caption={user.emailAddress}
                />
            ) : null}
        </>
    );
}
