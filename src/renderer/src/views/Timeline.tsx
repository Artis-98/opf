import { useFarm, useNow } from "../state";
import { displayStatus, schedule, STATUS_LABEL } from "./Farm";
import { inWorkingHours } from "../../../core/schedule";
import { clock, dayName } from "../format";
import { printerPicture } from "../components/PrinterArt";

const HOURS = 48;
const PXH = 44;
const LABEL = 160;

export function TimelineView({ onPick }: { onPick: (id: string) => void }) {
  const { snap } = useFarm();
  const now = useNow(30_000);
  const s = snap.data.settings;
  const t0 = new Date(now);
  t0.setMinutes(0, 0, 0);
  const W = HOURS * PXH;
  const x = (d: Date) => ((d.getTime() - t0.getTime()) / 3_600_000) * PXH;

  // Shade every hour nobody is in the workshop, so "waits for morning" is visible.
  const closed: { l: number; w: number }[] = [];
  for (let h = 0; h < HOURS; h++) {
    const d = new Date(t0.getTime() + h * 3_600_000);
    if (!inWorkingHours(s, d)) {
      const last = closed[closed.length - 1];
      if (last && last.l + last.w === h * PXH) last.w += PXH;
      else closed.push({ l: h * PXH, w: PXH });
    }
  }
  const ticks = Array.from({ length: HOURS / 2 + 1 }, (_, i) => new Date(t0.getTime() + i * 2 * 3_600_000));

  return (
    <div className="tl">
      <div className="tl-head">
        <h2>Timeline</h2>
        <span className="muted">Next 48 hours, every printer. Prints run unattended{s.overnightOk ? " through the night" : " only until closing"}; the next plate waits for someone to clear the bed ({String(s.workStart).padStart(2, "0")}:00–{String(s.workEnd).padStart(2, "0")}:00).</span>
        <div className="legend">
          <span><i className="sw" style={{ background: "var(--accent)" }} />Printing</span>
          <span><i className="sw" style={{ background: "color-mix(in srgb, var(--accent) 35%, var(--panel-3))" }} />Queued</span>
          <span><i className="sw" style={{ background: "var(--err)" }} />Stopped</span>
          <span><i className="sw" style={{ background: "var(--night)" }} />Nobody in</span>
        </div>
      </div>
      <div className="tl-scroll">
        <div className="tl-grid" style={{ width: W + LABEL }}>
          <div className="tl-row tl-axis">
            <div className="tl-label"><span>Printer</span></div>
            <div className="tl-track">
              {ticks.map((d, i) => (
                <span key={i} className={`tick ${d.getHours() < 2 ? "day" : ""}`} style={{ left: i * 2 * PXH }}>
                  {d.getHours() < 2 ? `${dayName(d)} ` : ""}{String(d.getHours()).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>
          {snap.data.printers.map((p) => {
            const st = displayStatus(snap.live[p.id], snap.data.current[p.id]);
            const slots = schedule(snap, p.id, now);
            const q = snap.data.queues[p.id]?.length ?? 0;
            const picture = printerPicture(p.model);
            return (
              <div key={p.id} className="tl-row">
                <button className={`tl-label ${picture ? "with-pic" : ""}`} onClick={() => onPick(p.id)}>
                  {picture && <img src={picture} alt="" />}
                  <span className="tl-text"><b>{p.name}</b><span>{STATUS_LABEL[st]}{q ? ` · ${q} queued` : ""}</span></span>
                </button>
                <div className="tl-track">
                  {closed.map((c, i) => <div key={i} className="night" style={{ left: c.l, width: c.w }} />)}
                  {st === "offline" && <button className="blk off" style={{ left: 4, width: 260 }} onClick={() => onPick(p.id)}>Offline{q ? ` · ${q} plate${q > 1 ? "s" : ""} waiting` : ""}</button>}
                  {st === "finished" && <button className="blk wait" style={{ left: Math.max(0, x(now)), width: 84 }} onClick={() => onPick(p.id)}>Clear bed</button>}
                  {st !== "offline" && slots.map((sl) => {
                    const l = Math.max(0, x(sl.start));
                    const r = Math.min(W, x(sl.end));
                    if (r <= l) return null;
                    const cls = sl.current ? (st === "error" ? "err" : st === "paused" ? "paused" : "cur") : "next";
                    return (
                      <button key={sl.job.id} className={`blk ${cls}`} style={{ left: l, width: Math.max(4, r - l - 2) }} onClick={() => onPick(p.id)}
                        title={`${sl.job.name} · ${clock(sl.start, now)} → ${clock(sl.end, now)}`}>
                        {sl.job.name}<small>{clock(sl.end, now)}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="nowline" style={{ left: LABEL + x(now) }} />
        </div>
      </div>
    </div>
  );
}
