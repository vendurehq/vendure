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
exports.PosTerminalService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const typeorm_2 = require("typeorm");
const pos_terminal_entity_1 = require("../entities/pos-terminal.entity");
const pos_session_entity_1 = require("../entities/pos-session.entity");
let PosTerminalService = class PosTerminalService {
    constructor(connection) {
        this.connection = connection;
    }
    async findAll(channelId) {
        const qb = this.connection
            .getRepository(pos_terminal_entity_1.PosTerminal)
            .createQueryBuilder('terminal')
            .leftJoinAndSelect('terminal.channel', 'channel')
            .leftJoinAndSelect('terminal.stockLocation', 'stockLocation');
        if (channelId) {
            qb.where('channel.id = :channelId', { channelId });
        }
        return qb.getMany();
    }
    async findOne(id) {
        return this.connection.getRepository(pos_terminal_entity_1.PosTerminal).findOne({
            where: { id },
            relations: ['channel', 'stockLocation'],
        });
    }
    async findByCode(code) {
        return this.connection.getRepository(pos_terminal_entity_1.PosTerminal).findOne({
            where: { code },
            relations: ['channel', 'stockLocation'],
        });
    }
    async create(input) {
        var _a;
        const existing = await this.findByCode(input.code);
        if (existing) {
            throw new core_1.UserInputError(`终端编号 ${input.code} 已存在`);
        }
        const terminal = new pos_terminal_entity_1.PosTerminal();
        terminal.code = input.code;
        terminal.name = input.name;
        terminal.channel = { id: input.channelId };
        terminal.stockLocation = { id: input.stockLocationId };
        terminal.active = true;
        terminal.deviceConfig = (_a = input.deviceConfig) !== null && _a !== void 0 ? _a : null;
        const saved = await this.connection.getRepository(pos_terminal_entity_1.PosTerminal).save(terminal);
        const reloaded = await this.findOne(saved.id);
        if (!reloaded)
            throw new Error(`终端 ${saved.id} 创建后查询失败`);
        return reloaded;
    }
    async update(id, input) {
        const terminal = await this.findOne(id);
        if (!terminal)
            throw new core_1.UserInputError(`终端 ${id} 不存在`);
        if (input.name !== undefined)
            terminal.name = input.name;
        if (input.stockLocationId !== undefined) {
            terminal.stockLocation = { id: input.stockLocationId };
        }
        if (input.active !== undefined)
            terminal.active = input.active;
        if (input.deviceConfig !== undefined)
            terminal.deviceConfig = input.deviceConfig;
        await this.connection.getRepository(pos_terminal_entity_1.PosTerminal).save(terminal);
        const reloaded = await this.findOne(id);
        if (!reloaded)
            throw new Error(`终端 ${id} 更新后查询失败`);
        return reloaded;
    }
    async delete(id) {
        var _a;
        const terminal = await this.findOne(id);
        if (!terminal)
            return false;
        // 历史班次与对账数据不可丢：无外键级联时直接删终端会被 pos_session 外键拒绝（或误删历史）。
        // 这里先校验引用关系，有班次时给出可读错误并引导停用，无班次时保持原删除行为。
        const sessionCount = await this.connection
            .getRepository(pos_session_entity_1.PosSession)
            .createQueryBuilder('session')
            .where('session.terminalId = :id', { id })
            .getCount();
        if (sessionCount > 0) {
            throw new core_1.UserInputError(`终端 ${terminal.code} 已被 ${sessionCount} 个班次引用，删除会丢失对账数据。` +
                `已阻止删除，请改用停用（active=false）。`);
        }
        const result = await this.connection.getRepository(pos_terminal_entity_1.PosTerminal).delete(id);
        return ((_a = result.affected) !== null && _a !== void 0 ? _a : 0) > 0;
    }
};
exports.PosTerminalService = PosTerminalService;
exports.PosTerminalService = PosTerminalService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], PosTerminalService);
//# sourceMappingURL=pos-terminal.service.js.map