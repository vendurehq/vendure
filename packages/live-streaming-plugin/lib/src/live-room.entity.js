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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveRoom = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
const live_room_platform_entity_1 = require("./live-room-platform.entity");
const live_room_product_entity_1 = require("./live-room-product.entity");
let LiveRoom = class LiveRoom extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.LiveRoom = LiveRoom;
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], LiveRoom.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "coverUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "streamerCustomerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "streamerName", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 'product' }),
    __metadata("design:type", String)
], LiveRoom.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 'scheduled' }),
    __metadata("design:type", String)
], LiveRoom.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "scheduledStartAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "startedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "endedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "streamKey", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "playUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], LiveRoom.prototype, "replayUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 0 }),
    __metadata("design:type", Number)
], LiveRoom.prototype, "likeCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 0 }),
    __metadata("design:type", Number)
], LiveRoom.prototype, "viewCount", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => live_room_product_entity_1.LiveRoomProduct),
    (0, typeorm_1.JoinTable)(),
    __metadata("design:type", Array)
], LiveRoom.prototype, "products", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => live_room_platform_entity_1.LiveRoomPlatform, p => p.liveRoom),
    __metadata("design:type", Array)
], LiveRoom.prototype, "platforms", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => core_1.Channel),
    (0, typeorm_1.JoinTable)(),
    __metadata("design:type", Array)
], LiveRoom.prototype, "channels", void 0);
exports.LiveRoom = LiveRoom = __decorate([
    (0, typeorm_1.Entity)(),
    __metadata("design:paramtypes", [Object])
], LiveRoom);
