// The small OPF that opens from its icon by the clock: every printer at a glance, the buttons
// that are needed at the printer (the bed is clear, start the next plate, resume), and a way
// into the full OPF for everything else.

import { useEffect, useState } from "react";
import { opf } from "../bridge";
import { useFarm, useNow } from "../state";
import { displayStatus, farmSummary, STATUS_LABEL } from "../../../core/status";
import type { PrinterConfig, PrinterStatus } from "../../../core/types";
import type { UpdateInfo } from "../../../preload/api";
import { Icon } from "../components/icons";
import { clock, dur } from "../format";
import { schedule } from "./Farm";

// The printers that wait for someone come first.
const ORDER: Record<PrinterStatus, number> = { error: 0, finished: 1, paused: 2, printing: 3, preparing: 3, idle: 4, offline: 5 };
const PILL: Partial<Record<PrinterStatus, string>> = { printing: "ok", preparing: "ok", error: "err", finished: "warn", paused: "warn" };

export function MiniView() {
  const { snap } = useFarm();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    // The same look as OPF's window, which keeps it in this page's storage.
    try { document.documentElement.dataset.theme = localStorage.getItem("opf-theme") ?? "dark"; } catch { /* dark */ }
    void opf.updateState().then(setUpdate);
    return opf.onUpdateReady(setUpdate);
  }, []);
  if (!snap) return null;

  const status = (p: PrinterConfig) => displayStatus(snap.live[p.id], snap.data.current[p.id]);
  const printers = [...snap.data.printers].sort((a, b) => ORDER[status(a)] - ORDER[status(b)] || a.name.localeCompare(b.name));

  return (
    <div className="mini">
      <header className="mini-head">
        <span className="brand">{Icon.logo}OPF</span>
        <span className="sum">{farmSummary(snap)}</span>
      </header>
      <div className="mini-list">
        {printers.map((p) => <MiniPrinter key={p.id} printer={p} status={status(p)} />)}
        {!printers.length && <p className="muted">No printers yet. Open OPF to add them.</p>}
      </div>
      <footer className="mini-foot">
        {update && <button className="btn" title={update.changes.map((c) => `• ${c.subject}`).join("\n")} onClick={() => void opf.restart()}>Update · Restart</button>}
        <button className="btn pri" onClick={() => void opf.openFull?.()}>Open OPF</button>
      </footer>
    </div>
  );
}

function MiniPrinter({ printer: p, status: st }: { printer: PrinterConfig; status: PrinterStatus }) {
  const { snap, act, toast } = useFarm();
  const now = useNow();
  const live = snap!.live[p.id];
  const cur = snap!.data.current[p.id];
  const queue = snap!.data.queues[p.id] ?? [];
  const next = queue[0];
  const job = cur?.name ?? live?.jobName ?? "The print";

  let body: React.ReactNode;
  if (st === "printing" || st === "preparing" || st === "paused") {
    const end = schedule(snap!, p.id, now)[0]?.end;
    body = (
      <>
        <div className="line">{job}</div>
        <div className="bar"><i style={{ width: `${((live?.progress ?? 0) * 100).toFixed(1)}%`, background: st === "paused" ? "var(--warn)" : "var(--accent)" }} /></div>
        <div className="time">
          <span>{st === "preparing" ? "Heating up" : `${dur(live?.remainingSec)} left`}</span>
          <span>done {clock(end, now)}</span>
        </div>
        {st === "paused" && <div className="row"><button className="btn sm pri" onClick={() => act("resume", p.id)}>Resume</button></div>}
      </>
    );
  } else if (st === "finished") {
    body = (
      <>
        <div className="line">{job} is done. Take the parts off.</div>
        <div className="row">
          {next && <button className="btn sm pri" onClick={async () => { if ((await act("clearBed", p.id, true)) !== undefined) toast(`${p.name} started ${next.name}`); }}>Bed is clear, start {next.name}</button>}
          <button className={`btn sm ${next ? "" : "pri"}`} onClick={() => act("clearBed", p.id, false)}>{next ? "Clear, don't start" : "Bed is clear"}</button>
        </div>
      </>
    );
  } else if (st === "error") {
    body = <div className="line err">{live?.error ?? "The printer stopped."} Check it, then open OPF to resume or stop.</div>;
  } else if (st === "idle") {
    body = next
      ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="line">Next: {next.name}{queue.length > 1 ? ` +${queue.length - 1}` : ""}</span>
          <button className="btn sm pri" onClick={async () => { if ((await act("startNext", p.id)) !== undefined) toast(`${p.name} started ${next.name}`); }}>Start</button>
        </div>
      )
      : <div className="line">Nothing queued.</div>;
  } else {
    body = <div className="line">{live?.error ?? "Not connected."}</div>;
  }

  return (
    <div className={`mini-p s-${st}`}>
      <div className="top">
        <b>{p.name}</b>
        {queue.length > 0 && st !== "idle" && <span className="q">{queue.length} queued</span>}
        <span className={`pill ${PILL[st] ?? ""}`}>{STATUS_LABEL[st]}</span>
      </div>
      {body}
    </div>
  );
}
