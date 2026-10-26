import { AdministratorAvatar } from '@/vdb/components/shared/administrator-avatar.js';

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
            <AdministratorAvatar
                preview={user.avatar?.preview}
                name={`${user.firstName} ${user.lastName}`}
                className="size-8"
            />
            {showDetails ? (
                <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-heading font-semibold text-accent-foreground">
                        {user.firstName} {user.lastName}
                    </span>
                    <span className="truncate text-xs">{user.emailAddress}</span>
                </div>
            ) : null}
        </>
    );
}
