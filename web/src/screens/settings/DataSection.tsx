import { Download, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { MACRO_PARAMS, type ServerState } from "@jusik/shared";
import { excelUrl, saveSettings, syncExport } from "../../api";
import { useApp } from "../../app/AppContext";
import { Link } from "../../app/router";
import { Button, MarketStatus, Notice, RuleTag, Section, fmtInt, fmtNum, fmtWhen, useToast } from "../../ui";
import { ActionBar, NumField } from "./parts";
import { ISM_MAX, ISM_MIN, ismDraftOf, ismNotes, parseIsm, prevMonth, providerLabel, sameIsm, thisMonthUtc, type IsmDraft } from "./settingsModel";
import { SectionLoading, ServerMissing } from "./status";
import type { DraftProps, SecProps } from "./types";

/*
 * 데이터·내보내기: 데이터 출처와 샘플 모드, 자동 스캔 상태, ISM 직접 입력(2.3), 기록 내보내기(엑셀·구글 스프레드시트).
 * 스캔 조건(점수·거래대금·시장·주기·분봉 확인)은 발굴 > 스크리너에서 바꾼다.
 */

function Source() {
  const { health } = useApp();
  return (
    <>
      <dl className="glb-dl">
        <div>
          <dt>시세·재무</dt>
          <dd>{providerLabel(health?.provider, health?.sample)}</dd>
        </div>
        <div>
          <dt>기준 시각</dt>
          <dd>실시간이 아닐 수 있어요. 시세 화면마다 'HH:mm 기준' 시각을 함께 보여 줘요.</dd>
        </div>
      </dl>
      {health?.sample ? (
        <Notice title="샘플 데이터 모드예요">
          종목·가격·지표는 실제 시세가 아니라 임의로 만든 값이에요. 서버를 PROVIDER=web으로 켜면 네이버 금융·야후 파이낸스에서 받아요.
        </Notice>
      ) : (
        <p className="t-cap">네이버 금융·야후 파이낸스 웹페이지에서 개인 용도로 낮은 빈도로 읽어와요. 사이트 이용약관과 접근 정책은 직접 확인하세요.</p>
      )}
    </>
  );
}

function Scheduler({ server }: { server: ServerState }) {
  const { now, serverAt } = useApp();
  const sch = server.status.scheduler;
  const state = sch.scanning ? "스캔 중이에요" : sch.running ? "켜져 있어요" : "꺼져 있어요";
  return (
    <>
      <dl className="glb-dl">
        <div>
          <dt>자동 실행</dt>
          <dd>{state}</dd>
        </div>
        <div>
          <dt>마지막 스캔</dt>
          <dd className="num">{fmtWhen(sch.lastScanAt, now)}</dd>
        </div>
        <div>
          <dt>다음 스캔</dt>
          <dd className="num">{sch.running ? fmtWhen(sch.nextScanAt, now) : "-"}</dd>
        </div>
        <div>
          <dt>장 상태</dt>
          <dd className="row wrap">
            <MarketStatus region="KR" now={now} asOf={serverAt} />
            <MarketStatus region="US" now={now} asOf={serverAt} />
          </dd>
        </div>
      </dl>
      <p className="t-2">
        {sch.running
          ? `장이 열린 동안 ${fmtInt(server.settings.scanIntervalMin)}분마다 자동으로 새로 찾고, 보유 종목은 ${fmtInt(server.settings.monitorIntervalSec)}초마다 점검해요. 공휴일은 구분하지 못해요.`
          : "서버의 자동 실행이 꺼져 있어(SCHEDULER=off) '지금 스캔'을 누를 때만 찾아요."}{" "}
        스캔 조건은 <Link to="/discover/screener">발굴 · 스크리너</Link>에서 바꿔요.
      </p>
      {sch.lastError && (
        <Notice tone="warn" title="최근 스캔에서 오류가 났어요">
          {sch.lastError} 다음 스캔에서 다시 시도해요. 계속되면 서버 기록을 확인하세요.
        </Notice>
      )}
    </>
  );
}

function Ism({ server, compact, drafts, setDraft }: { server: ServerState; compact: boolean } & DraftProps) {
  const { refreshServer, now } = useApp();
  const toast = useToast();
  const savedIsm = server.settings.ismManual ?? null;
  const draft: IsmDraft = drafts.ism ?? ismDraftOf(savedIsm);
  const parsed = parseIsm(draft);
  const dirty = parsed.ok ? !sameIsm(parsed.value ?? null, savedIsm) : true;
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errs = !parsed.ok && tried ? parsed.errors : {};
  const notes = parsed.ok ? ismNotes(parsed.value ?? null, now) : [];
  const used = server.latestScan?.macroSummary?.ism ?? null;
  const edit = (patch: Partial<IsmDraft>) => setDraft("ism", { ...draft, ...patch });

  const save = async () => {
    setTried(true);
    if (!parsed.ok) {
      document.getElementById(parsed.errors.value ? "glb-ism-value" : "glb-ism-month")?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveSettings({ ismManual: parsed.value ?? null });
      await refreshServer();
      setDraft("ism", null);
      setTried(false);
      toast(parsed.value ? "ISM 값을 저장했어요. 다음 스캔부터 적용돼요." : "직접 입력을 지웠어요. 다음 스캔부터 사이트 값을 써요.", "ok");
    } catch (e) {
      setError(`ISM 값을 저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}. 서버 연결을 확인하고 다시 저장하세요.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="t-2">
        사이트에서 ISM을 못 읽을 때 매월 첫 영업일 발표값을 넣어요. {MACRO_PARAMS.ismLine} 이상이면 제조업 확장, 아래면 수축으로 보고 국면 점수의 매크로 신호에 써요. 직접 넣은 값이 사이트 값보다
        먼저 쓰이니, 사이트에 더 새 값이 나오면 지워 주세요.
      </p>
      <div className="glb-grid">
        <NumField
          id="glb-ism-value"
          label="PMI 값"
          unit="pt"
          value={draft.value}
          onChange={(v) => edit({ value: v })}
          placeholder="예: 48.7"
          hint={`${ISM_MIN}~${ISM_MAX} 사이, 소수 첫째 자리까지`}
          error={errs.value}
        />
        <div className="ui-field">
          <label className="lbl" htmlFor="glb-ism-month">
            가리키는 달
          </label>
          <input
            id="glb-ism-month"
            className="ui-input num"
            type="month"
            value={draft.month}
            max={prevMonth(thisMonthUtc(now))}
            aria-invalid={errs.month ? true : undefined}
            aria-describedby="glb-ism-month-desc"
            onChange={(e) => edit({ month: e.target.value })}
          />
          {errs.month ? (
            <span className="err" id="glb-ism-month-desc">
              {errs.month}
            </span>
          ) : (
            <span className="hint" id="glb-ism-month-desc">
              지난달까지 고를 수 있어요(예: 2026-09)
            </span>
          )}
        </div>
      </div>
      <dl className="glb-dl">
        <div>
          <dt>저장된 값</dt>
          <dd>
            {savedIsm ? (
              <span className="num">
                {savedIsm.value.toFixed(1)} ({savedIsm.month})
              </span>
            ) : (
              "없음 · 사이트 값이나 대용 지표를 써요"
            )}
          </dd>
        </div>
        <div>
          <dt>최근 스캔에 쓴 값</dt>
          <dd>
            {used ? (
              <>
                <span className="num t-medium">{fmtNum(used.value, 1)}</span>{" "}
                <span className="t-2">
                  ({used.month} · {used.source === "수동" ? "직접 입력" : "ISM 사이트"} · {used.value >= MACRO_PARAMS.ismLine ? "확장" : "수축"})
                </span>
              </>
            ) : server.latestScan ? (
              "없음 · 지역 연준 제조업 지수가 있으면 대용으로 판단했어요"
            ) : (
              "아직 스캔 전이에요"
            )}
          </dd>
        </div>
      </dl>
      {notes.map((n) => (
        <Notice key={n}>{n}</Notice>
      ))}
      {parsed.ok && parsed.value === null && savedIsm && <p className="t-cap">저장하면 직접 입력을 지우고 사이트 값을 써요.</p>}
      {error && <Notice tone="warn">{error}</Notice>}
      <ActionBar sticky={compact && dirty}>
        <span className="t-2 glb-actions-note">{dirty ? "다음 스캔부터 적용돼요" : "저장한 값과 같아요"}</span>
        <div className="glb-actions-btns">
          {dirty ? (
            <Button variant="ghost" onClick={() => (setDraft("ism", null), setTried(false), setError(null))}>
              되돌리기
            </Button>
          ) : (
            <Button variant="ghost" disabled={!draft.value && !draft.month} icon={<X size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={() => edit({ value: "", month: "" })}>
              직접 입력 지우기
            </Button>
          )}
          <Button variant="primary" size={compact ? "lg" : "md"} disabled={!dirty} busy={saving} onClick={() => void save()}>
            ISM 저장
          </Button>
        </div>
      </ActionBar>
    </>
  );
}

function Export({ server }: { server: ServerState }) {
  const { refreshServer, now } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ex = server.status.export;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await syncExport();
      await refreshServer();
      toast("기록을 내보냈어요", "ok");
    } catch (e) {
      setError(`내보내지 못했어요: ${e instanceof Error ? e.message : String(e)}. 서버 연결을 확인하고 다시 시도하세요.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="t-2">모의매매·매매일지·스캔 기록을 엑셀 파일로 저장해요. 기록이 바뀌면 서버가 자동으로 다시 저장해요.</p>
      <dl className="glb-dl">
        <div>
          <dt>로컬 엑셀</dt>
          <dd>
            {ex.excel.ok === false ? (
              <span className="warn-text">저장하지 못했어요{ex.excel.error ? `: ${ex.excel.error}` : ""}</span>
            ) : ex.excel.at ? (
              <span className="num">{fmtWhen(ex.excel.at, now)} 저장</span>
            ) : (
              "아직 저장 전이에요"
            )}
            <span className="t-cap glb-path">{ex.excel.path}</span>
          </dd>
        </div>
        <div>
          <dt>구글 스프레드시트</dt>
          <dd>
            {!ex.sheets.configured ? (
              <span className="t-2">연결하지 않았어요. 서버 설정(server/.env.example)의 구글 항목을 채우면 함께 보내요.</span>
            ) : ex.sheets.ok === false ? (
              <span className="warn-text">동기화하지 못했어요{ex.sheets.error ? `: ${ex.sheets.error}` : ""}</span>
            ) : ex.sheets.at ? (
              <span className="num">
                {fmtWhen(ex.sheets.at, now)} 동기화{ex.sheets.rows != null ? ` · ${fmtInt(ex.sheets.rows)}행` : ""}
              </span>
            ) : (
              "아직 동기화 전이에요"
            )}
          </dd>
        </div>
      </dl>
      {error && <Notice tone="warn">{error}</Notice>}
      <div className="row wrap">
        <a className="ui-btn secondary glb-a-btn" href={excelUrl} download>
          <Download size={16} strokeWidth={1.5} aria-hidden="true" />
          엑셀 내려받기
        </a>
        <Button variant="ghost" busy={busy} icon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={() => void run()}>
          {ex.sheets.configured ? "지금 엑셀·시트로 내보내기" : "지금 내보내기"}
        </Button>
      </div>
    </>
  );
}

export function DataSection({ gh, bp, drafts, setDraft }: SecProps & DraftProps) {
  const { server, offline } = useApp();
  return (
    <>
      <Section title="데이터 출처" as={gh}>
        <Source />
      </Section>
      {!server ? (
        offline ? (
          <ServerMissing />
        ) : (
          <SectionLoading rows={4} />
        )
      ) : (
        <>
          <Section title="자동 스캔" as={gh}>
            <Scheduler server={server} />
          </Section>
          <Section title="ISM 제조업지수 직접 입력" as={gh} sub={<RuleTag rule="2.3 강영현·강동진" />}>
            <Ism server={server} compact={bp === "compact"} drafts={drafts} setDraft={setDraft} />
          </Section>
          <Section title="기록 내보내기" as={gh}>
            <Export server={server} />
          </Section>
        </>
      )}
    </>
  );
}
