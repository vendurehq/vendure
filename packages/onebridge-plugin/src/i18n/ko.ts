import type { BusinessLine, CrossBorderStage, CustomsStatus } from '../types';
import type { LocalePack, TimelineCopy } from './zh';

/**
 * 韩文文案（占位）。
 * TODO(韩文待定稿)：14 态为 C 端 locales/ko.json 的现有示意译文，仅作占位；
 * 6 个清关态、三条时间轴、物流 5 节点尚无正式韩文，一律留空字符串，
 * 读取时回落中文（见 index.ts）。定稿只改本文件，不动枚举与 stageIndex。
 */
export const ko: LocalePack = {
    stage: {
        lost: '종결',
        wait_pay: '결제 대기',
        quoting: '견적 진행',
        requirement: '요구사항 확인',
        sourcing: '공장 매칭',
        risk: '리스크 검토',
        sample: '샘플 확인',
        producing: '생산 진행',
        shipping: '운송 중',
        qc: '검품 중',
        refund: '사후 처리',
        delivered: '납품 완료',
        customs: '통관 · 인도',
        done: '완료',
    },
    customsStatus: {
        not_started: '',
        docs_preparing: '',
        declared: '',
        inspecting: '',
        cleared: '',
        hold: '',
    },
    timeline: {
        net: emptyTimeline(7),
        pond: emptyTimeline(6),
        hook: emptyTimeline(7),
    },
    logistics: {
        steps: ['', '', '', '', ''],
    },
};

function emptyTimeline(length: number): TimelineCopy[] {
    return Array.from({ length }, () => ({ title: '', desc: '' }));
}

export type { CrossBorderStage, CustomsStatus, BusinessLine };
