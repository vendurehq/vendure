import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    MutationRunScheduledTaskArgs,
    MutationUpdateScheduledTaskArgs,
    Permission,
} from '@vendure/common/lib/generated-types';

import { SchedulerService } from '../../../scheduler/scheduler.service';
import { Allow } from '../../decorators/allow.decorator';

@Resolver()
export class ScheduledTaskResolver {
    constructor(private readonly schedulerService: SchedulerService) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadSystem)
    scheduledTasks() {
        return this.schedulerService.getTaskList();
    }

    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateSystem)
    updateScheduledTask(@Args() { input }: MutationUpdateScheduledTaskArgs) {
        return this.schedulerService.updateTask(input);
    }

    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateSystem)
    runScheduledTask(@Args() { id }: MutationRunScheduledTaskArgs) {
        return this.schedulerService.runTask(id);
    }
}
