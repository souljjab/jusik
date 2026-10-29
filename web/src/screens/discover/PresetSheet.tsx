import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { josa } from "@jusik/shared";
import { Button, Field, Sheet, useBreakpoint, useToast } from "../../ui";
import { draftSummary, type ScanDraft } from "./logic";
import { PRESET_NAME_MAX, cleanPresetName, presetNameProblem, removePreset, renamePreset, upsertPreset, useSavedPresets, type SavedPreset } from "./presets";

/**
 * 내 전략 저장·관리 시트(지도서 5.3 C '전략으로 저장', 부록 A '전략 만들기'는 컴퓨터).
 * save: 지금 조건에 이름을 붙여 저장. manage: 이름 바꾸기와 지우기.
 */
export function PresetSheet({ mode, draft, onClose }: { mode: "save" | "manage" | null; draft: ScanDraft; onClose: () => void }) {
  const bp = useBreakpoint();
  return (
    <Sheet
      open={mode != null}
      onClose={onClose}
      title={mode === "manage" ? "내 전략 관리" : "전략으로 저장"}
      side={bp === "compact" ? "bottom" : "center"}
      initialFocus={mode === "save" ? "#disc-preset-name" : undefined}
    >
      {mode === "save" ? <SaveForm draft={draft} onDone={onClose} /> : mode === "manage" ? <Manage /> : null}
    </Sheet>
  );
}

const SAVE_FAIL = "이 기기에 저장하지 못했어요. 브라우저의 사이트 데이터 저장을 허용한 뒤 다시 저장하세요.";

function SaveForm({ draft, onDone }: { draft: ScanDraft; onDone: () => void }) {
  const toast = useToast();
  const { presets, save } = useSavedPresets();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const n = cleanPresetName(name);
  const overwrite = presets.find((p) => p.name === n);
  const submit = () => {
    const problem = presetNameProblem(name, presets);
    if (problem) return setError(problem);
    if (!save(upsertPreset(presets, n, draft))) return setError(SAVE_FAIL);
    toast(overwrite ? `'${n}' 전략의 조건을 지금 조건으로 바꿨어요.` : `'${n}' 전략을 저장했어요. 프리셋 줄에서 눌러 불러올 수 있어요.`, "ok");
    onDone();
  };
  return (
    <form
      className="stack-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="t-2">지금 편집 칸의 조건을 이름을 붙여 저장해요. 저장한 전략은 프리셋 줄의 '내 전략'에서 눌러 다시 불러와요.</p>
      <dl className="disc-kv disc-preset-sum">
        <dt className="t-2">저장할 조건</dt>
        <dd>{draftSummary(draft)}</dd>
      </dl>
      <Field
        label="전략 이름"
        htmlFor="disc-preset-name"
        hint={overwrite ? `같은 이름의 전략이 있어요. 저장하면 그 전략의 조건을 지금 조건으로 바꿔요.` : `${PRESET_NAME_MAX}자까지. 이 기기(브라우저)에 저장돼요.`}
        error={error}
      >
        <input
          id="disc-preset-name"
          className="ui-input"
          maxLength={PRESET_NAME_MAX + 10}
          placeholder="예: 거래대금 넉넉한 코스피"
          value={name}
          onChange={(e) => (setName(e.target.value), setError(null))}
        />
      </Field>
      <div className="row wrap disc-sheet-actions">
        <Button variant="ghost" type="button" onClick={onDone}>
          취소
        </Button>
        <Button variant="primary" type="submit">
          {overwrite ? "이 이름으로 덮어쓰기" : "전략으로 저장"}
        </Button>
      </div>
    </form>
  );
}

function Manage() {
  const { presets, save } = useSavedPresets();
  const toast = useToast();
  if (!presets.length) return <p className="t-2">저장한 전략이 없어요. 스크리너에서 조건을 고른 뒤 '전략으로 저장'을 누르세요.</p>;
  return (
    <div className="stack-4">
      <p className="t-2">이름을 고치거나 쓰지 않는 전략을 지워요. 이 기기(브라우저)에 저장된 목록이에요.</p>
      <ul className="disc-plain disc-preset-list">
        {presets.map((p) => (
          <PresetRow
            key={p.id}
            p={p}
            onRename={(name) => {
              const problem = presetNameProblem(name, presets, p.id);
              if (problem) return problem;
              if (!save(renamePreset(presets, p.id, name))) return SAVE_FAIL;
              const n = cleanPresetName(name);
              toast(`전략 이름을 '${n}'${josa(n, "으로/로").slice(n.length)} 바꿨어요.`, "ok");
              return null;
            }}
            onRemove={() => {
              if (!save(removePreset(presets, p.id))) return toast(SAVE_FAIL, "warn");
              toast(`'${p.name}' 전략을 지웠어요.`, "ok");
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function PresetRow({ p, onRename, onRemove }: { p: SavedPreset; onRename: (name: string) => string | null; onRemove: () => void }) {
  const [name, setName] = useState(p.name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(p.name), [p.name]);
  const id = `disc-preset-${p.id}`;
  const changed = cleanPresetName(name) !== p.name;
  return (
    <li className="disc-preset-row">
      <form
        className="disc-preset-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) setError(onRename(name));
        }}
      >
        <label className="sr-only" htmlFor={id}>
          {p.name} 전략 이름
        </label>
        <input id={id} className="ui-input" value={name} maxLength={PRESET_NAME_MAX + 10} onChange={(e) => (setName(e.target.value), setError(null))} aria-invalid={error ? true : undefined} aria-describedby={`${id}-sum`} />
        <Button variant="secondary" size="sm" type="submit" disabled={!changed}>
          이름 바꾸기
        </Button>
        <Button variant="ghost" size="sm" type="button" onClick={onRemove}>
          지우기
        </Button>
      </form>
      <p id={`${id}-sum`} className="t-cap">
        {draftSummary(p.draft)}
      </p>
      {error && (
        <p className="t-cap disc-warn-line" role="alert">
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
          {error}
        </p>
      )}
    </li>
  );
}
