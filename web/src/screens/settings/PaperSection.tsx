import { useState } from "react";
import { paperEquity, type Currency, type ServerState } from "@jusik/shared";
import { resetPaper, saveSettings } from "../../api";
import { useApp } from "../../app/AppContext";
import { Link } from "../../app/router";
import { Button, Notice, Section, Sheet, Toggle, arrowOf, fmtAsOf, fmtInt, fmtMoneyByCurrency, fmtPnlByCurrency, toneOf, useToast } from "../../ui";
import { ActionBar, NumField } from "./parts";
import { MONITOR_RANGE, monitorError, parseNum } from "./settingsModel";
import { SectionLoading, ServerMissing } from "./status";
import type { DraftProps, SecProps } from "./types";

/*
 * 모의계좌: 자동 실행 켜고 끄기, 보유 점검 주기, 계좌 요약, 초기화(확인 시트).
 * 실제 주문은 내지 않는다. 서버가 규칙대로 가상 체결하고 매매일지에 자동으로 적는다.
 */

const CURS: Currency[] = ["KRW", "USD"];
const CUR_NAME: Record<Currency, string> = { KRW: "원화", USD: "달러" };

function AccountSummary({ server }: { server: ServerState }) {
  const { serverAt } = useApp();
  return (
    <div className="glb-accts">
      {CURS.map((c) => {
        const a = server.paper[c];
        const eq = paperEquity(a);
        const rate = a.closed > 0 ? (a.wins / a.closed) * 100 : null;
        return (
          <dl key={c} className="glb-acct" aria-label={`${CUR_NAME[c]} 모의계좌`}>
            <div className="glb-acct-head">
              <dt className="t-medium">{CUR_NAME[c]} 모의계좌</dt>
              <dd className="num t-section">{fmtMoneyByCurrency(eq, c)}</dd>
            </div>
            <div>
              <dt className="t-2">현금</dt>
              <dd className="num">{fmtMoneyByCurrency(a.cash, c)}</dd>
            </div>
            <div>
              <dt className="t-2">보유</dt>
              <dd className="num">{fmtInt(a.positions.length)}종목</dd>
            </div>
            <div>
              <dt className="t-2">실현 손익</dt>
              <dd className={`num ${toneOf(a.realizedPnl)}`}>
                {arrowOf(a.realizedPnl) && <span aria-hidden="true">{arrowOf(a.realizedPnl)} </span>}
                {fmtPnlByCurrency(a.realizedPnl, c)}
              </dd>
            </div>
            <div>
              <dt className="t-2">청산 · 이긴 거래</dt>
              <dd className="num">
                {fmtInt(a.closed)}건 · {rate == null ? "-" : `${fmtInt(a.wins)}건(${rate.toFixed(0)}%)`}
              </dd>
            </div>
          </dl>
        );
      })}
      <p className="t-cap">
        평가 자산은 보유 종목의 최근 가격으로 계산했어요{serverAt ? ` · ${fmtAsOf(serverAt)}` : ""}. 종목별 손익은 <Link to="/trade">매매 · 보유</Link>에서 봐요.
      </p>
    </div>
  );
}

function ResetPaper({ server, compact }: { server: ServerState; compact: boolean }) {
  const { refreshServer } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = server.settings;
  const amounts = `${fmtMoneyByCurrency(s.depositKRW, "KRW")} · ${fmtMoneyByCurrency(s.depositUSD, "USD")}`;
  const held = server.paper.KRW.positions.length + server.paper.USD.positions.length;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await resetPaper();
      await refreshServer();
      toast("모의계좌를 예수금으로 초기화했어요", "ok");
      setOpen(false);
    } catch (e) {
      setError(`초기화하지 못했어요: ${e instanceof Error ? e.message : String(e)}. 서버 연결을 확인하고 다시 시도하세요.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="t-2">
        원화·달러 모의계좌를 예수금(<span className="num">{amounts}</span>)으로 다시 시작해요. 매매일지와 복기 기록은 그대로 남아요.
      </p>
      <div>
        <Button variant="secondary" onClick={() => (setError(null), setOpen(true))}>
          모의계좌 초기화
        </Button>
      </div>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="모의계좌를 초기화할까요?"
        side={compact ? "bottom" : "center"}
        footer={
          <div className="row end wrap">
            <Button variant="ghost" size={compact ? "lg" : "md"} onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button variant="primary" size={compact ? "lg" : "md"} busy={busy} onClick={() => void run()}>
              모의계좌 초기화
            </Button>
          </div>
        }
      >
        <div className="stack-3">
          <Notice tone="warn">
            {held > 0 ? `보유 중인 모의 종목 ${held}개가 청산 기록 없이 사라지고, ` : "현금과 실현 손익·승률이 처음으로 돌아가고, "}되돌릴 수 없어요.
          </Notice>
          <p>
            원화·달러 모의계좌를 예수금(<span className="num">{amounts}</span>)으로 다시 시작해요. 매매일지와 복기 기록은 그대로 남아요.
          </p>
          {error && <Notice tone="warn">{error}</Notice>}
        </div>
      </Sheet>
    </>
  );
}

export function PaperSection({ gh, bp, drafts, setDraft }: SecProps & DraftProps) {
  const { server, offline, refreshServer } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState<"toggle" | "monitor" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monErrShown, setMonErrShown] = useState(false);
  if (!server) return offline ? <ServerMissing /> : <SectionLoading rows={4} />;
  const s = server.settings;
  const compact = bp === "compact";

  const toggle = async (on: boolean) => {
    setBusy("toggle");
    setError(null);
    try {
      await saveSettings({ paperEnabled: on });
      await refreshServer();
      toast(on ? "모의매매 자동 실행을 켰어요. 장이 열린 동안 계획대로 모의로 사고팔아요." : "모의매매 자동 실행을 껐어요. 새로 들어가지 않아요.", "ok");
    } catch (e) {
      setError(`바꾸지 못했어요: ${e instanceof Error ? e.message : String(e)}. 서버 연결을 확인하고 다시 시도하세요.`);
    } finally {
      setBusy(null);
    }
  };

  const monitor = drafts.monitor ?? String(s.monitorIntervalSec);
  const monErr = monitorError(monitor);
  const monDirty = parseNum(monitor) !== s.monitorIntervalSec;
  const saveMonitor = async () => {
    setMonErrShown(true);
    if (monErr) {
      document.getElementById("glb-monitor")?.focus();
      return;
    }
    setBusy("monitor");
    setError(null);
    try {
      await saveSettings({ monitorIntervalSec: parseNum(monitor)! });
      await refreshServer();
      setDraft("monitor", null);
      setMonErrShown(false);
      toast("점검 주기를 저장했어요", "ok");
    } catch (e) {
      setError(`점검 주기를 저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}. 서버 연결을 확인하고 다시 저장하세요.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {error && <Notice tone="warn">{error}</Notice>}

      <Section title="자동 실행" as={gh}>
        <Toggle
          checked={s.paperEnabled}
          disabled={busy === "toggle"}
          onChange={(v) => void toggle(v)}
          label={<span className="t-medium">규칙대로 모의매매 자동 실행 + 매매일지 자동 작성</span>}
          hint={s.paperEnabled ? "켜져 있어요" : "꺼져 있어요"}
        />
        <ul className="glb-bullets t-2">
          <li>장이 열린 동안 스캔할 때마다 오늘의 계획대로 모의로 들어가고, 손절가·목표가·보유 기한에 닿으면 청산해요.</li>
          <li>체결은 가상이며 수수료·세금·슬리피지(0.1%)를 반영해요. 실제 주문은 내지 않아요.</li>
          <li>켜 두면 계획과 주문 검토의 계좌 기준이 예수금 대신 모의계좌 자산이 돼요.</li>
          <li>끄면 지금 보유는 그대로 관리하고, 새로 들어가지는 않아요.</li>
        </ul>
      </Section>

      <Section title="보유 점검 주기" as={gh}>
        <div className="glb-grid">
          <NumField
            id="glb-monitor"
            label="보유 종목 점검 주기"
            unit="초"
            integer
            value={monitor}
            onChange={(v) => setDraft("monitor", v)}
            onBlur={() => setMonErrShown(true)}
            hint={`모의계좌 보유 종목의 손절가·목표가를 이 주기로 확인하고, 손절가 근접 알림도 이때 만들어요(${MONITOR_RANGE.min}~${MONITOR_RANGE.max.toLocaleString("ko-KR")}초).`}
            error={monErrShown ? monErr : null}
          />
        </div>
        <ActionBar sticky={compact && monDirty}>
          <span className="t-2 glb-actions-note">{monDirty ? "저장해야 적용돼요" : "저장한 값과 같아요"}</span>
          <div className="glb-actions-btns">
            {monDirty && (
              <Button variant="ghost" onClick={() => (setDraft("monitor", null), setMonErrShown(false))}>
                되돌리기
              </Button>
            )}
            <Button variant="primary" size={compact ? "lg" : "md"} disabled={!monDirty} busy={busy === "monitor"} onClick={() => void saveMonitor()}>
              점검 주기 저장
            </Button>
          </div>
        </ActionBar>
      </Section>

      <Section title="계좌" as={gh}>
        <AccountSummary server={server} />
      </Section>

      <Section title="초기화" as={gh}>
        <ResetPaper server={server} compact={compact} />
      </Section>
    </>
  );
}
