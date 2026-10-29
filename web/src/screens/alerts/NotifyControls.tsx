import { BellRing, Moon, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { digestSummary } from "../../app/notify";
import { inDnd, normDigest, setPrefs, usePrefs } from "../../app/prefs";
import { Button, IconButton, Notice, Toggle, useToast } from "../../ui";
import {
  DIGEST_MAX_TIMES, HOUR_OPTIONS, NOTIFY_TEXT, digestTimesProblem, dndProblem, minuteOptions, nextDigestTime, notifyState, splitTime,
  type NotifyEnv, type NotifyState,
} from "./alertsModel";
import "./alerts.css";

/*
 * 방해 금지와 브라우저 알림, 장중 신호 요약(UI 지도서 7.2 C·7.4). 알림 센터와 설정 > 알림이 같이 쓴다.
 * 이 설정은 이 기기(브라우저)에만 저장된다. 방해 금지·신호 요약은 브라우저 알림에만 쓰이고, 알림 센터에는 그대로 쌓인다.
 * 푸시 서버가 없어서 브라우저 알림은 앱(탭)이 열려 있을 때만 뜬다. 시각은 한국 시간 24시 표기(지도서 3.2)로 고른다.
 */

function readEnv(): NotifyEnv {
  const supported = typeof window !== "undefined" && "Notification" in window;
  return {
    supported,
    secure: typeof window === "undefined" ? false : window.isSecureContext !== false,
    permission: supported ? Notification.permission : null,
  };
}

/** 브라우저 알림 권한 상태. 다른 탭·사이트 설정에서 바꿔도 창으로 돌아오면 다시 읽는다 */
export function useNotifyEnv(): [NotifyEnv, () => void] {
  const [env, setEnv] = useState<NotifyEnv>(readEnv);
  const reread = useCallback(() => setEnv(readEnv()), []);
  useEffect(() => {
    window.addEventListener("focus", reread);
    document.addEventListener("visibilitychange", reread);
    let status: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: "notifications" as PermissionName })
      .then((s) => {
        status = s;
        s.onchange = reread;
      })
      .catch(() => {});
    return () => {
      window.removeEventListener("focus", reread);
      document.removeEventListener("visibilitychange", reread);
      if (status) status.onchange = null;
    };
  }, [reread]);
  return [env, reread];
}

export function useNotifyState(): NotifyState {
  const prefs = usePrefs();
  const [env] = useNotifyEnv();
  return notifyState(env, prefs.notify);
}

/** 방해 금지 한 줄: 아이콘, 구간, 지금 상태, 켜고 끄기 */
export function DndToggleRow({ now, className = "" }: { now: Date; className?: string }) {
  const prefs = usePrefs();
  const d = prefs.dnd;
  const active = d.enabled && !dndProblem(d) && inDnd(d, now);
  const what = d.allowRisk ? "리스크 알림만 띄워요" : "브라우저 알림을 띄우지 않아요";
  const sub = !d.enabled ? "꺼져 있어요. 시간과 상관없이 브라우저 알림을 띄워요." : active ? `지금 방해 금지 중이에요. ${d.end}까지 ${what}.` : `이 시간에는 ${what}.`;
  return (
    <div className={`glb-dndrow ${className}`}>
      <Moon className="glb-dndrow-ico" size={20} strokeWidth={1.5} aria-hidden="true" />
      <Toggle
        className="glb-dndrow-toggle"
        checked={d.enabled}
        onChange={(v) => setPrefs((p) => ({ dnd: { ...p.dnd, enabled: v } }))}
        label={<span className="t-medium">{`방해 금지 ${d.start}~${d.end}`}</span>}
        hint={sub}
      />
    </div>
  );
}

/**
 * 24시 시각 고르기: 시·분 두 칸(분은 5분 단위). 값은 "HH:MM".
 * 브라우저의 시각 칸(type=time)은 언어 설정에 따라 '오후 10:00'처럼 12시로 보여 쓰지 않는다.
 */
export function TimeSelect({ value, onChange, label, disabled, invalid }: { value: string; onChange: (v: string) => void; label: string; disabled?: boolean; invalid?: boolean }) {
  const [h, m] = splitTime(value);
  return (
    <span className="glb-tsel" role="group" aria-label={label}>
      <select className="ui-select num" aria-label={`${label}, 시`} value={h} disabled={disabled} aria-invalid={invalid || undefined} onChange={(e) => onChange(`${e.target.value}:${m}`)}>
        {HOUR_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="glb-tsel-sep" aria-hidden="true">
        :
      </span>
      <select className="ui-select num" aria-label={`${label}, 분`} value={m} disabled={disabled} aria-invalid={invalid || undefined} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
        {minuteOptions(m).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </span>
  );
}

/** 방해 금지 시간과 리스크 예외 */
export function DndEditor() {
  const prefs = usePrefs();
  const d = prefs.dnd;
  const base = useId();
  const problem = dndProblem(d);
  const commit = (patch: Partial<typeof d>) => setPrefs((p) => ({ dnd: { ...p.dnd, ...patch } }));
  return (
    <div className="glb-dnd-editor">
      <Toggle checked={d.enabled} onChange={(v) => commit({ enabled: v })} label="방해 금지 시간 쓰기" hint="기본값은 22:00~07:00이에요." />
      <div className="glb-times" role="group" aria-labelledby={`${base}-lbl`}>
        <span id={`${base}-lbl`} className="sr-only">
          방해 금지 시간
        </span>
        <div className="glb-time">
          <span className="t-2" aria-hidden="true">
            시작
          </span>
          <TimeSelect label="시작" value={d.start} disabled={!d.enabled} invalid={!!problem} onChange={(v) => commit({ start: v })} />
        </div>
        <div className="glb-time">
          <span className="t-2" aria-hidden="true">
            끝
          </span>
          <TimeSelect label="끝" value={d.end} disabled={!d.enabled} invalid={!!problem} onChange={(v) => commit({ end: v })} />
        </div>
      </div>
      {d.enabled && problem && <Notice tone="warn">{problem}</Notice>}
      <Toggle
        checked={d.allowRisk}
        disabled={!d.enabled}
        onChange={(v) => commit({ allowRisk: v })}
        label="리스크 알림은 받기"
        hint="손절가 근접·신규 매수 멈춤 알림은 방해 금지 시간에도 띄워요."
      />
      <p className="t-cap">한국 시간 기준이에요. 시작이 끝보다 늦으면 자정을 넘겨 다음 날 아침까지예요. 방해 금지 중에도 알림 센터에는 그대로 쌓여요.</p>
    </div>
  );
}

/**
 * 장중 신호 요약(지도서 7.4 '장중 신호는 묶어서 정해진 시각에 요약으로 받는 선택지'). 이 기기에만 저장한다.
 * 켜면 신호 알림을 하나씩 띄우지 않고 정한 시각마다 '신호 N건: …' 한 번으로 띄운다(app/notify). 리스크·공시·국면은 바로.
 * 시각 줄은 고치는 동안 순서를 지키고(저장은 이른 순·겹침 없이), 다른 곳에서 바뀌면 다시 읽는다.
 */
export function DigestEditor({ browserOn }: { browserOn: boolean }) {
  const prefs = usePrefs();
  const d = prefs.digest;
  const base = useId();
  const ids = useRef(0);
  const rowsOf = (times: string[]) => times.map((t) => ({ id: ids.current++, t }));
  const [rows, setRows] = useState(() => rowsOf(d.times));
  useEffect(() => {
    setRows((cur) => (normDigest({ times: cur.map((r) => r.t) }).times.join() === d.times.join() ? cur : rowsOf(d.times)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.times]);
  const commitRows = (next: { id: number; t: string }[]) => {
    setRows(next);
    setPrefs((p) => ({ digest: { ...p.digest, times: normDigest({ times: next.map((r) => r.t) }).times } }));
  };
  const problem = digestTimesProblem(rows.map((r) => r.t));
  return (
    <div className="glb-digest">
      <Toggle
        checked={d.enabled}
        onChange={(v) => setPrefs((p) => ({ digest: { ...p.digest, enabled: v } }))}
        label="장중 신호를 묶어서 받기"
        hint={digestSummary(d)}
      />
      <div className="glb-digest-times" role="group" aria-labelledby={`${base}-lbl`}>
        <span id={`${base}-lbl`} className="t-2">
          요약 받을 시각
        </span>
        <ul>
          {rows.map((r, i) => (
            <li key={r.id}>
              <TimeSelect
                label={`요약 시각 ${i + 1}`}
                value={r.t}
                disabled={!d.enabled}
                onChange={(v) => commitRows(rows.map((x) => (x.id === r.id ? { ...x, t: v } : x)))}
              />
              <IconButton label={`${r.t} 빼기`} disabled={!d.enabled || rows.length <= 1} onClick={() => commitRows(rows.filter((x) => x.id !== r.id))}>
                <X size={18} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
        {rows.length < DIGEST_MAX_TIMES && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!d.enabled}
              icon={<Plus size={16} strokeWidth={1.5} aria-hidden="true" />}
              onClick={() => commitRows([...rows, { id: ids.current++, t: nextDigestTime(rows.map((x) => x.t)) }])}
            >
              시각 더하기
            </Button>
          </div>
        )}
      </div>
      {d.enabled && problem && <Notice tone="warn">{problem}</Notice>}
      <p className="t-cap">
        신호 알림을 하나씩 띄우지 않고 이 시각(한국 시간)마다 '신호 N건: 종목 이름'으로 한 번에 띄워요. 리스크·공시·국면 알림은 그대로 바로 띄워요.
        {prefs.dnd.enabled && " 방해 금지 시간에 걸린 요약은 다음 시각에 띄워요."}
        {!browserOn && " 브라우저 알림을 켜야 요약도 떠요."}
      </p>
    </div>
  );
}

/** 알림이 생기는 때(서버가 스캔·보유 점검 때 남긴다. 기준값은 앱 기본값) */
export function AlertSources() {
  return (
    <div className="glb-sources">
      <dl>
      <div>
        <dt className="cat signal">신호</dt>
        <dd>스캔할 때 점수가 높은 후보 5종목까지. 근거 몇 개 중 몇 개가 맞았는지 함께 적어요.</dd>
      </div>
      <div>
        <dt className="cat risk">리스크</dt>
        <dd>모의계좌 보유 종목이 손절가 2% 안으로 들어오거나, 일일 손실 한도·연속 손실로 신규 매수를 멈출 때.</dd>
      </div>
      <div>
        <dt className="cat disclosure">공시</dt>
        <dd>모의계좌 보유 종목에 오늘 공시가 올라왔을 때.</dd>
      </div>
      <div>
        <dt className="cat regime">국면</dt>
        <dd>시장 국면이 바뀌었을 때. 바뀐 주식 비중 상한을 함께 적어요.</dd>
      </div>
      </dl>
      <p className="t-cap">같은 종목의 같은 신호는 하루 한 번만 남겨요. 서버의 자동 실행이 꺼져 있으면 지금 스캔을 눌렀을 때만 생겨요.</p>
    </div>
  );
}

/** 브라우저 알림 켜기(권한 요청)와 시험 알림 */
export function BrowserNotify() {
  const prefs = usePrefs();
  const toast = useToast();
  const [env, reread] = useNotifyEnv();
  const state = notifyState(env, prefs.notify);
  const [asking, setAsking] = useState(false);
  const blocked = state === "unsupported" || state === "insecure" || state === "denied";

  const turn = async (on: boolean) => {
    if (!on) return setPrefs({ notify: false });
    if (blocked) return;
    if (Notification.permission === "granted") return setPrefs({ notify: true });
    setAsking(true);
    try {
      const r = await Notification.requestPermission();
      if (r === "granted") {
        setPrefs({ notify: true });
        toast("브라우저 알림을 켰어요", "ok");
      } else if (r === "denied") {
        setPrefs({ notify: false });
        toast("브라우저에서 알림을 막았어요. 사이트 설정에서 허용하면 켤 수 있어요.", "warn");
      } else {
        toast("권한을 묻는 창을 닫았어요. 다시 켜면 다시 물어요.", "info");
      }
    } catch {
      toast("알림 권한을 요청하지 못했어요. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.", "warn");
    } finally {
      setAsking(false);
      reread();
    }
  };

  const test = () => {
    try {
      new Notification("알림 시험", { body: "새 알림이 오면 이렇게 떠요. 누르면 해당 화면으로 가요.", tag: "jusik-test" });
    } catch {
      toast("이 브라우저는 페이지에서 바로 알림을 띄울 수 없어요. 알림 센터에서 확인하세요.", "warn");
    }
  };

  return (
    <div className="glb-notify">
      <Toggle
        checked={state === "on" || (prefs.notify && state === "ask")}
        disabled={blocked || asking}
        onChange={(v) => void turn(v)}
        label={
          <span className="row" style={{ gap: 6 }}>
            <BellRing size={16} strokeWidth={1.5} aria-hidden="true" />
            새 알림을 브라우저 알림으로도 받기
          </span>
        }
        hint={NOTIFY_TEXT[state]}
      />
      {state === "denied" && <Notice tone="warn">{NOTIFY_TEXT.denied}</Notice>}
      {state === "on" && (
        <div>
          <Button variant="ghost" size="sm" onClick={test}>
            시험 알림 띄우기
          </Button>
        </div>
      )}
      <p className="t-cap">앱(이 브라우저 탭)이 열려 있을 때만 떠요. 푸시 서버가 없어서 앱을 닫으면 오지 않아요. 새 알림은 20초마다 확인하고, 한 번에 3건까지 띄워요.</p>
      <DigestEditor browserOn={state === "on"} />
    </div>
  );
}
