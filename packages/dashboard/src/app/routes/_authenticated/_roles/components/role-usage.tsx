import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';

const roleAssignmentsForRoleDocument = graphql(`
    query RoleAssignmentsForRole($options: RoleAssignmentListOptions) {
        roleAssignments(options: $options) {
            items {
                id
                user {
                    id
                    identifier
                }
                channel {
                    id
                    code
                }
            }
            totalItems
        }
    }
`);

const TAKE = 100;

export interface RoleUsageProps {
    roleId: string;
}

/**
 * Shows where a Role is used: the Users it is assigned to, and on which Channels,
 * read from the `roleAssignments` query.
 */
export function RoleUsage({ roleId }: Readonly<RoleUsageProps>) {
    const { data } = useQuery({
        queryKey: ['roleAssignments', roleId],
        queryFn: () =>
            api.query(roleAssignmentsForRoleDocument, {
                options: {
                    filter: { roleId: { eq: roleId } },
                    take: TAKE,
                },
            }),
    });

    if (!data) {
        return null;
    }

    const { items, totalItems } = data.roleAssignments;
    if (totalItems === 0) {
        return (
            <div className="text-sm text-muted-foreground">
                <Trans>This role is not assigned to any user</Trans>
            </div>
        );
    }

    const users = new Map<string, { identifier: string; channelCodes: string[] }>();
    for (const assignment of items) {
        let user = users.get(assignment.user.id);
        if (!user) {
            user = { identifier: assignment.user.identifier, channelCodes: [] };
            users.set(assignment.user.id, user);
        }
        if (!user.channelCodes.includes(assignment.channel.code)) {
            user.channelCodes.push(assignment.channel.code);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>
                            <Trans>User</Trans>
                        </TableHead>
                        <TableHead>
                            <Trans>Channels</Trans>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {Array.from(users.entries()).map(([userId, user]) => (
                        <TableRow key={userId}>
                            <TableCell>{user.identifier}</TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-1">
                                    {user.channelCodes.map(code => (
                                        <Badge key={code} variant="secondary">
                                            <ChannelCodeLabel code={code} />
                                        </Badge>
                                    ))}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {totalItems > items.length && (
                <div className="text-sm text-muted-foreground">
                    <Trans>
                        Showing the first {items.length} of {totalItems} assignments
                    </Trans>
                </div>
            )}
        </div>
    );
}
