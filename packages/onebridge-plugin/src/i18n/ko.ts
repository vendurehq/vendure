import type { BusinessLine, CrossBorderStage, CustomsStatus } from '../types';
import type { LocalePack } from './zh';

/**
 * 韩文文案。
 * 14 态与 6 个清关态取自 C 端 locales/ko.json 的现有示意译文；
 * 三条时间轴仅回填资源库中可直接对应的词条：
 * hook[0..5] 取 onebridge-web/gql/data/site.ts 的 process，
 * net[0/4/5/6]、pond[1/4] 取 C 端 ko.json / site.ts 的既有词组；
 * 其余标题与描述、物流 2 个节点仍留空，读取时按字段回落中文（见 index.ts）。
 * 定稿只改本文件，不动枚举与 stageIndex。
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
        not_started: '통관 전',
        docs_preparing: '서류 준비 중',
        declared: '신고 완료',
        inspecting: '검사 중',
        cleared: '통관 완료',
        hold: '보류',
    },
    timeline: {
        net: [
            { title: '주문 생성', desc: '' },
            { title: '', desc: '' },
            { title: '', desc: '' },
            { title: '', desc: '' },
            { title: '중한 물류', desc: '' },
            { title: '통관 및 한국 배송', desc: '' },
            { title: '수령 완료', desc: '' },
        ],
        pond: [
            { title: '', desc: '' },
            { title: '사양 확인', desc: '' },
            { title: '', desc: '' },
            { title: '', desc: '' },
            { title: '출하 전 검품', desc: '사진과 검사 기록을 출하 전 제공합니다.' },
            { title: '', desc: '' },
        ],
        hook: [
            { title: '요청 · 사양 확정', desc: '' },
            { title: '공장 매칭 · 견적', desc: '' },
            { title: '계약 · 대금 안전', desc: '' },
            { title: '생산 · 일정 관리', desc: '' },
            { title: '출하 전 검품', desc: '사진과 검사 기록을 출하 전 제공합니다.' },
            { title: '합포장 · 통관', desc: '' },
            { title: '', desc: '' },
        ],
    },
    logistics: {
        steps: ['요청 접수', '확인 · 견적', '', '', '배송 · 사후'],
    },
};

export type { CrossBorderStage, CustomsStatus, BusinessLine };
