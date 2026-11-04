import { ID, RequestContext } from '@vendure/core';
import { MessageJob } from './message-job';
import { MessageService } from './message.service';
export declare class MessageAdminResolver {
    private messageService;
    private messageJob;
    constructor(messageService: MessageService, messageJob: MessageJob);
    messages(ctx: RequestContext, options?: any): Promise<import("@vendure/core").PaginatedList<import("..").Message>>;
    message(ctx: RequestContext, id: ID): Promise<import("..").Message | null>;
    messageDeliveryStats(ctx: RequestContext, id: ID): Promise<any>;
    createMessage(ctx: RequestContext, input: any): Promise<import("..").Message>;
    updateMessage(ctx: RequestContext, id: ID, input: any): Promise<import("..").Message>;
    deleteMessage(ctx: RequestContext, id: ID): Promise<boolean>;
    sendMessage(ctx: RequestContext, id: ID): Promise<import("..").Message>;
}
