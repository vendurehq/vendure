import { CrossBorderStage } from './types';
export declare function allowedRfqTransitions(from: CrossBorderStage): readonly CrossBorderStage[];
export declare function canTransitionRfq(from: CrossBorderStage, to: CrossBorderStage): boolean;
/** 非法跃迁抛 INVALID_STAGE_TRANSITION（M2 的 resolver 直接透出错误码） */
export declare function assertRfqTransition(from: CrossBorderStage, to: CrossBorderStage): void;
