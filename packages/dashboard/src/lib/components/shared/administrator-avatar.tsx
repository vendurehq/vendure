import { Avatar, AvatarFallback, AvatarImage } from '@/vdb/components/ui/avatar.js';
import { User } from 'lucide-react';

export interface AdministratorAvatarProps {
    preview?: string | null;
    name?: string;
    className?: string;
}

export function AdministratorAvatar({ preview, name, className }: AdministratorAvatarProps) {
    return (
        <Avatar className={className}>
            {preview ? <AvatarImage src={preview} alt={name ?? ''} className="object-cover" /> : null}
            <AvatarFallback>
                <User className="size-1/2 text-muted-foreground" aria-hidden="true" />
            </AvatarFallback>
        </Avatar>
    );
}
