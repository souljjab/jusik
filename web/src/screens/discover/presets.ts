import { useCallback, useEffect, useState } from "react";
import { changedKeys, scanDraftOf, type ScanDraft } from "./logic";

/*
 * 내 전략(지도서 5.3 A·C, 부록 A '전략 만들기'): 스크리너 조건 묶음에 이름을 붙여 저장하고 프리셋 줄에서 다시 불러온다.
 * 시장 전체 스캔은 단타 돌파 규칙만 돌리므로, 내 전략은 그 스캔의 조건(최소 점수·거래대금·대상 시장 등) 묶음이다.
 * 이 기기(브라우저)에 저장한다 — 다른 화면 설정(종목 메모, 홈 시장 선택)과 같은 방식.
 */

export interface SavedPreset {
  id: string;
  name: string;
  draft: ScanDraft;
  savedAt: string;
}

const KEY = "jusik.discover.presets.v1";
export const PRESET_NAME_MAX = 20;
export const PRESET_MAX = 12;

/** 이름 다듬기(앞뒤 공백·연속 공백, 최대 길이) */
export const cleanPresetName = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, PRESET_NAME_MAX);

/** 저장 전 이름 점검. 문제가 없으면 null */
export function presetNameProblem(name: string, list: SavedPreset[], exceptId?: string): string | null {
  const n = cleanPresetName(name);
  if (!n) return "전략 이름을 적어 주세요.";
  if (n === "단타 돌파(스캔)") return "기본 프리셋과 같은 이름은 쓸 수 없어요.";
  if (!exceptId && !list.some((p) => p.name === n) && list.length >= PRESET_MAX) return `내 전략은 ${PRESET_MAX}개까지 저장할 수 있어요. 쓰지 않는 전략을 지운 뒤 저장하세요.`;
  if (exceptId && list.some((p) => p.name === n && p.id !== exceptId)) return "같은 이름의 전략이 이미 있어요.";
  return null;
}

/** 저장 목록 읽기(망가진 값은 버리고, 이전 버전 조건은 기본값으로 채운다) */
export function normalizePresets(raw: unknown): SavedPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPreset[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Partial<SavedPreset>;
    const name = typeof o.name === "string" ? cleanPresetName(o.name) : "";
    if (!name || typeof o.id !== "string" || !o.draft || typeof o.draft !== "object") continue;
    if (out.some((p) => p.id === o.id || p.name === name)) continue;
    out.push({ id: o.id, name, draft: scanDraftOf(o.draft), savedAt: typeof o.savedAt === "string" ? o.savedAt : "" });
  }
  return out.slice(0, PRESET_MAX);
}

/** 이름으로 저장: 같은 이름이 있으면 그 전략의 조건을 바꾸고, 없으면 끝에 더한다 */
export function upsertPreset(list: SavedPreset[], name: string, draft: ScanDraft, now: Date = new Date(), newId: () => string = randomId): SavedPreset[] {
  const n = cleanPresetName(name);
  const savedAt = now.toISOString();
  const hit = list.find((p) => p.name === n);
  if (hit) return list.map((p) => (p.id === hit.id ? { ...p, draft: scanDraftOf(draft), savedAt } : p));
  return [...list, { id: newId(), name: n, draft: scanDraftOf(draft), savedAt }];
}

export const renamePreset = (list: SavedPreset[], id: string, name: string): SavedPreset[] => list.map((p) => (p.id === id ? { ...p, name: cleanPresetName(name) } : p));
export const removePreset = (list: SavedPreset[], id: string): SavedPreset[] => list.filter((p) => p.id !== id);

/** 지금 조건이 이 전략과 같은가(칩을 눌린 상태로 보여 준다) */
export const presetMatches = (p: SavedPreset, draft: ScanDraft) => changedKeys(p.draft, draft).length === 0;

function randomId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function load(): SavedPreset[] {
  try {
    return normalizePresets(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

const listeners = new Set<(l: SavedPreset[]) => void>();

/** 내 전략 목록과 바꾸기. 저장하지 못하면(사생활 보호 모드 등) false */
export function useSavedPresets(): { presets: SavedPreset[]; save: (next: SavedPreset[]) => boolean } {
  const [presets, setPresets] = useState<SavedPreset[]>(load);
  useEffect(() => {
    const on = (l: SavedPreset[]) => setPresets(l);
    listeners.add(on);
    const onStorage = (e: StorageEvent) => e.key === KEY && setPresets(load());
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(on);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const save = useCallback((next: SavedPreset[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    for (const l of listeners) l(next);
    return true;
  }, []);
  return { presets, save };
}
