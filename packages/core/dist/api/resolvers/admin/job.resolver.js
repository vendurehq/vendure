"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const generated_types_1 = require("@vendure/common/lib/generated-types");
const errors_1 = require("../../../common/error/errors");
const config_1 = require("../../../config");
const job_queue_1 = require("../../../job-queue");
const job_buffer_service_1 = require("../../../job-queue/job-buffer/job-buffer.service");
const allow_decorator_1 = require("../../decorators/allow.decorator");
let JobResolver = class JobResolver {
    constructor(configService, jobService, jobBufferService) {
        this.configService = configService;
        this.jobService = jobService;
        this.jobBufferService = jobBufferService;
    }
    async job(args) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return;
        }
        return strategy.findOne(args.jobId);
    }
    async jobs(args) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return {
                items: [],
                totalItems: 0,
            };
        }
        return strategy.findMany(args.options || undefined);
    }
    async jobsById(args) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return [];
        }
        return strategy.findManyById(args.jobIds || undefined);
    }
    jobQueues() {
        return this.jobService.getJobQueues();
    }
    async removeSettledJobs(args) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return 0;
        }
        return strategy.removeSettledJobs(args.queueNames || [], args.olderThan);
    }
    async cancelJob(args) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return;
        }
        const job = await strategy.cancelJob(args.jobId);
        if (!job) {
            throw new errors_1.EntityNotFoundError('Job', args.jobId);
        }
        return job;
    }
    async jobBufferSize(args) {
        const bufferSizes = await this.jobBufferService.bufferSize(args.bufferIds);
        return Object.entries(bufferSizes).map(([bufferId, size]) => ({ bufferId, size }));
    }
    async flushBufferedJobs(args) {
        await this.jobBufferService.flush(args.bufferIds);
        return { success: true };
    }
    requireInspectableJobQueueStrategy() {
        if (!(0, config_1.isInspectableJobQueueStrategy)(this.configService.jobQueueOptions.jobQueueStrategy)) {
            return;
        }
        return this.configService.jobQueueOptions.jobQueueStrategy;
    }
};
exports.JobResolver = JobResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.ReadSettings, generated_types_1.Permission.ReadSystem),
    __param(0, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobResolver.prototype, "job", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.ReadSettings, generated_types_1.Permission.ReadSystem),
    __param(0, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobResolver.prototype, "jobs", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.ReadSettings, generated_types_1.Permission.ReadSystem),
    __param(0, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobResolver.prototype, "jobsById", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.ReadSettings, generated_types_1.Permission.ReadSystem),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], JobResolver.prototype, "jobQueues", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.DeleteSettings, generated_types_1.Permission.DeleteSystem),
    __param(0, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobResolver.prototype, "removeSettledJobs", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.DeleteSettings, generated_types_1.Permission.DeleteSystem),
    __param(0, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobResolver.prototype, "cancelJob", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.ReadSettings, generated_types_1.Permission.ReadSystem),
    __param(0, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobResolver.prototype, "jobBufferSize", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.UpdateSettings, generated_types_1.Permission.UpdateSystem),
    __param(0, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobResolver.prototype, "flushBufferedJobs", null);
exports.JobResolver = JobResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        job_queue_1.JobQueueService,
        job_buffer_service_1.JobBufferService])
], JobResolver);
//# sourceMappingURL=job.resolver.js.map