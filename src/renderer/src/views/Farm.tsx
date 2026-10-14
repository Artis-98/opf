import { useMemo, useState, type DragEvent } from "react";
import { useFarm, useNow } from "../state";
import { opf } from "../bridge";
import { schedulePrinter, type Slot } from "../../../core/schedule";
import { filamentWarning, matchFilaments } from "../../../core/filament";
import { wrongPrinter } from "../../../core/assign";
import type { InboxItem, PlateJob, PrinterConfig, PrinterStatus, Snapshot } from "../../../core/types";
import { PlateThumb, PrinterArt } from "../components/PrinterArt";
import { Icon } from "../components/icons";
import { clock, dur, hms, shortDate } from "../format";

export { displayStatus, STATUS_LABEL } from "../../../core/status";
import { displayStatus, STATUS_LABEL } from "../../../core/status";

export function schedule(snap: Snapshot, id: string, now: Date): Slot[] {
  return schedulePrinter(snap.data.settings, snap.live[id], snap.data.current[id], snap.data.queues[id] ?? [], now).slots;
}

type Filter = "all" | "printing" | "idle" | "attention";
const NEEDS_YOU: PrinterStatus[] = ["error", "finished", "paused", "offline"];

function matches(f: Filter, st: PrinterStatus) {
  return f === "all" || (f === "printing" ? st === "printing" || st === "preparing" : f === "idle" ? st === "idle" : NEEDS_YOU.includes(st));
}

export interface FarmProps {
  sel: string | null;
  setSel: (id: string | null) => void;
  onAddPlate: (printerId: string) => void;
  onPrepareInbox: (item: InboxItem) => void;
  onAddPrinter: (place?: { shelfId: string; slot: number }) => void;
  onEditPrinter: (id: string) => void;
  /** In OPF Slicer: open a queued plate's project in its Prepare tab. */
  onEditPlate?: (job: PlateJob) => void;
  /** A plate to point out for a moment (just sent from OPF Slicer). */
  flash?: string | null;
}

export function FarmView(props: FarmProps) {
  const { snap } = useFarm();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState(false);
  const now = useNow();

  if (!snap.data.printers.length) return <Welcome onAdd={() => props.onAddPrinter()} />;

  return (
    <div className="farm">
      <Sidebar filter={filter} setFilter={setFilter} onPrepareInbox={props.onPrepareInbox} now={now} />
      <Floor {...props} filter={filter} editing={editing} setEditing={setEditing} now={now} />
      <aside className="insp">
        {props.sel && snap.data.printers.some((p) => p.id === props.sel)
          ? <Inspector key={props.sel} id={props.sel} now={now} onAddPlate={props.onAddPlate} onEdit={props.onEditPrinter} onEditPlate={props.onEditPlate} flash={props.flash} />
          : <NothingSelected setSel={props.setSel} now={now} />}
      </aside>
    </div>
  );
}

function Welcome({ onAdd }: { onAdd: () => void }) {
  const { toast } = useFarm();
  return (
    <div className="welcome">
      <h2>Your farm is empty</h2>
      <p>Add your printers and put them on shelves the way they stand in your workshop. Bambu Lab printers connect over your local network with their IP address, serial number and LAN access code.</p>
      <div className="row">
        <button className="btn pri" onClick={onAdd}>{Icon.plus}Add a printer</button>
        <button className="btn" onClick={async () => { await opf.loadDemo(); toast("Demo farm loaded. These printers are simulated."); }}>Try the demo farm</button>
      </div>
    </div>
  );
}

/* ---------- sidebar ---------- */

function Sidebar({ filter, setFilter, onPrepareInbox }: { filter: Filter; setFilter: (f: Filter) => void; onPrepareInbox: (i: InboxItem) => void; now: Date }) {
  const { snap, act } = useFarm();
  const sts = snap.data.printers.map((p) => displayStatus(snap.live[p.id], snap.data.current[p.id]));
  const count = (f: Filter) => sts.filter((s) => matches(f, s)).length;
  return (
    <aside className="side">
      <div>
        <h4>Show</h4>
        <div className="navlist">
          {([["all", "All printers"], ["printing", "Printing"], ["idle", "Idle"], ["attention", "Needs you"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} className={`navitem ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}><span>{l}</span><span className="n">{count(k)}</span></button>
          ))}
        </div>
      </div>
      <div>
        <h4>Shelves</h4>
        <div className="navlist">
          {snap.data.shelves.map((s) => (
            <button key={s.id} className="navitem" onClick={() => document.getElementById(`shelf-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <span>{s.name}</span><span className="n">{s.slots.filter(Boolean).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4>Inbox <span className="mono">{snap.data.inbox.length}</span></h4>
        <div className="inbox">
          {snap.data.inbox.map((it) => (
            <div className="ib" key={it.id}>
              <div className="ib-top">{it.ref ? <span className="ref">{it.ref}</span> : <span>{it.source}</span>}{it.due && <span>due {shortDate(it.due)}</span>}</div>
              <div className="ib-name">{it.name} ×{it.qty}</div>
              {(it.material || it.color) && <div className="ib-meta">{it.color && <i className="sw" style={{ background: it.color }} />}{it.material}</div>}
              {it.notes && <div className="muted">{it.notes}</div>}
              <div className="row">
                <button className="btn sm" onClick={() => onPrepareInbox(it)}>Prepare plate</button>
                <button className="btn sm ghost" onClick={() => act("removeInbox", it.id)}>Remove</button>
              </div>
            </div>
          ))}
          {!snap.data.inbox.length && <p className="muted" style={{ margin: 0 }}>Nothing waiting. Parts sent to OPF, from admin.iiteg.com or the local API, land here.</p>}
        </div>
      </div>
    </aside>
  );
}

/* ---------- shelves ---------- */

function Floor(props: FarmProps & { filter: Filter; editing: boolean; setEditing: (b: boolean) => void; now: Date }) {
  const { snap, act } = useFarm();
  const { editing, setEditing, sel, setSel, filter, now } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const byId = useMemo(() => new Map(snap.data.printers.map((p) => [p.id, p])), [snap.data.printers]);
  const unplaced = snap.data.printers.filter((p) => !snap.data.shelves.some((s) => s.slots.includes(p.id)));

  const dropProps = (shelfId: string, slot: number) => editing ? {
    onDragOver: (e: DragEvent) => { if (dragId) { e.preventDefault(); setOver(`${shelfId}:${slot}`); } },
    onDragLeave: () => setOver(null),
    onDrop: (e: DragEvent) => { e.preventDefault(); if (dragId) void act("placePrinter", dragId, shelfId, slot); setDragId(null); setOver(null); },
  } : {};

  return (
    <main className={`floor ${editing ? "editing" : ""}`}>
      <div className="floor-head">
        <h2>Workshop floor</h2>
        <span className="hint">{editing ? "Drag printers between slots. Dropping on a printer swaps the two." : "Click a printer to work on its queue."}</span>
        <span className="sp" />
        {editing && <button className="btn" onClick={() => act("addShelf")}>{Icon.plus}Add shelf</button>}
        {!editing && <button className="btn" onClick={() => props.onAddPrinter()}>{Icon.plus}Add printer</button>}
        <button className={`btn ${editing ? "pri" : ""}`} onClick={() => { setEditing(!editing); setRenaming(null); }}>{editing ? "Done" : "Edit shelves"}</button>
      </div>

      {snap.data.shelves.map((shelf) => {
        const ps = shelf.slots.filter(Boolean).map((id) => byId.get(id!)).filter(Boolean) as PrinterConfig[];
        const busy = ps.filter((p) => snap.live[p.id]?.status === "printing").length;
        return (
          <section key={shelf.id} id={`shelf-${shelf.id}`} style={{ scrollMarginTop: 12 }}>
            <div className="shelf-head">
              {renaming === shelf.id ? (
                <input autoFocus defaultValue={shelf.name} aria-label="Shelf name"
                  onBlur={(e) => { void act("renameShelf", shelf.id, e.target.value); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }} />
              ) : <h3>{shelf.name}</h3>}
              <span className="meta">{ps.length} printer{ps.length === 1 ? "" : "s"} · {busy} printing</span>
              {editing && (
                <span className="row" style={{ marginLeft: "auto" }}>
                  <button className="btn sm ghost" onClick={() => setRenaming(shelf.id)}>{Icon.edit}Rename</button>
                  <button className="btn sm ghost" onClick={() => act("addSlot", shelf.id)}>{Icon.plus}Slot</button>
                  <button className="btn sm ghost" disabled={!shelf.slots.includes(null)} onClick={() => act("removeSlot", shelf.id)}>− Slot</button>
                  <button className="btn sm ghost danger" disabled={ps.length > 0} title={ps.length ? "Move the printers off first" : ""} onClick={() => act("removeShelf", shelf.id)}>Remove shelf</button>
                </span>
              )}
            </div>
            <div className="shelf-row"><div className="slots" style={{ gridTemplateColumns: shelf.slots.map((x) => (x ? "minmax(150px, 1fr)" : "minmax(96px, 0.6fr)")).join(" ") }}>
              {shelf.slots.map((id, i) => {
                const p = id ? byId.get(id) : undefined;
                const key = `${shelf.id}:${i}`;
                if (!p) {
                  return editing
                    ? <div key={key} className={`slot-empty ${over === key ? "over" : ""}`} {...dropProps(shelf.id, i)}>Drop a printer here</div>
                    : <button key={key} className="slot-empty" onClick={() => props.onAddPrinter({ shelfId: shelf.id, slot: i })}>{Icon.plus}&nbsp;Add a printer here</button>;
                }
                return (
                  <PrinterCard key={key} printer={p} now={now} on={sel === p.id} faded={!matches(filter, displayStatus(snap.live[p.id], snap.data.current[p.id]))}
                    editing={editing} over={over === key} dragging={dragId === p.id}
                    onClick={() => !editing && setSel(sel === p.id ? null : p.id)}
                    onDragStart={() => setDragId(p.id)} onDragEnd={() => { setDragId(null); setOver(null); }}
                    drop={dropProps(shelf.id, i)} />
                );
              })}
            </div></div>
            <div className="plank" aria-hidden="true" />
          </section>
        );
      })}

      {unplaced.length > 0 && (
        <section>
          <div className="shelf-head"><h3>Not on a shelf</h3><span className="meta">Edit shelves and drag these into a slot.</span></div>
          <div className="slots" style={{ ["--n" as string]: Math.max(4, unplaced.length) }}>
            {unplaced.map((p) => (
              <PrinterCard key={p.id} printer={p} now={now} on={sel === p.id} faded={false} editing={editing} over={false} dragging={dragId === p.id}
                onClick={() => !editing && setSel(sel === p.id ? null : p.id)} onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)} drop={{}} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function PrinterCard({ printer: p, now, on, faded, editing, over, dragging, onClick, onDragStart, onDragEnd, drop }: {
  printer: PrinterConfig; now: Date; on: boolean; faded: boolean; editing: boolean; over: boolean; dragging: boolean;
  onClick: () => void; onDragStart: () => void; onDragEnd: () => void; drop: Record<string, unknown>;
}) {
  const { snap } = useFarm();
  const live = snap.live[p.id];
  const cur = snap.data.current[p.id];
  const st = displayStatus(live, cur);
  const slots = schedule(snap, p.id, now);
  const queue = snap.data.queues[p.id] ?? [];
  const last = slots[slots.length - 1];
  const nextJob = queue[0];
  const nextMissing = nextJob && live && st !== "offline" ? matchFilaments(nextJob, live).some((m) => !m.slot) : false;

  let time: React.ReactNode, sub: string, word = true, prog = 0;
  const jobName = cur?.name ?? live?.jobName ?? "Print";
  if (st === "printing" || st === "paused" || st === "preparing") {
    prog = live?.progress ?? 0;
    word = false;
    time = <>{dur(live?.remainingSec)}<small>{st === "preparing" ? "heating" : "left"}</small></>;
    sub = `${jobName} · done ${clock(slots[0]?.end, now)}`;
  } else if (st === "error") {
    prog = live?.progress ?? 0;
    time = live?.error?.split(".")[0] ?? "Error";
    sub = `${jobName} · stopped at ${Math.round(prog * 100)}%`;
  } else if (st === "finished") {
    prog = 1;
    time = "Clear the bed";
    sub = `${jobName} finished`;
  } else if (st === "idle") {
    time = "Idle";
    sub = nextJob ? `Next: ${nextJob.name}` : "Nothing queued";
  } else {
    time = "Offline";
    sub = live?.error ?? "Not connected";
  }

  return (
    <button className={`pc s-${st} ${on ? "on" : ""} ${faded ? "faded" : ""} ${over ? "over" : ""} ${dragging ? "dragging" : ""}`}
      onClick={onClick} draggable={editing} onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd} {...drop}
      aria-pressed={on} aria-label={`${p.name}, ${STATUS_LABEL[st]}`}>
      <div className="pc-top"><span className="pc-name">{p.name}</span><span className="pill">{STATUS_LABEL[st]}</span></div>
      <div className="pc-vis"><PrinterArt printer={p} live={live} job={cur} /></div>
      <div className={`pc-time ${word ? "word" : ""}`}>{time}</div>
      <div className="pc-sub">{sub}</div>
      <div className="bar"><i style={{ width: `${(prog * 100).toFixed(1)}%` }} /></div>
      <div className="pc-foot">
        <span>{queue.length ? `+${queue.length} queued` : "Queue empty"}{nextMissing && <span className="warnflag"> · load filament</span>}</span>
        <span>{st === "offline" ? "" : last ? `free ${clock(last.end, now)}` : "free now"}</span>
      </div>
    </button>
  );
}

/* ---------- inspector ---------- */

function NothingSelected({ setSel }: { setSel: (id: string) => void; now: Date }) {
  const { snap } = useFarm();
  const rows = snap.data.printers
    .map((p) => {
      const st = displayStatus(snap.live[p.id], snap.data.current[p.id]);
      const q = snap.data.queues[p.id]?.length ?? 0;
      const why: [string, string] | null =
        st === "error" ? [snap.live[p.id]?.error?.split(".")[0] ?? "Error", "err"]
        : st === "finished" ? ["Clear the bed", "warn"]
        : st === "paused" ? ["Paused", "warn"]
        : st === "idle" && q ? [`Idle, ${q} plate${q > 1 ? "s" : ""} waiting`, "ok"]
        : null;
      return { p, why };
    })
    .filter((r) => r.why);
  return (
    <div className="insp-sec" style={{ borderBottom: 0, gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>No printer selected</h3>
      <p className="muted" style={{ margin: 0 }}>Printers stay grey until you pick one. Click a printer to see it live and edit what it prints next.</p>
      <h4 style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--muted)" }}>Waiting on you</h4>
      <div className="need">
        {rows.map(({ p, why }) => (
          <button key={p.id} onClick={() => setSel(p.id)}><b>{p.name}</b><span className={`why ${why![1]}`}>{why![0]}</span></button>
        ))}
        {!rows.length && <p className="muted" style={{ margin: 0 }}>Nothing. Every printer is busy or has nothing queued.</p>}
      </div>
    </div>
  );
}

function Inspector({ id, now, onAddPlate, onEdit, onEditPlate, flash }: {
  id: string; now: Date; onAddPlate: (id: string) => void; onEdit: (id: string) => void; onEditPlate?: (job: PlateJob) => void; flash?: string | null;
}) {
  const { snap, act, toast } = useFarm();
  const [confirmStop, setConfirmStop] = useState(false);
  // Starting a plate whose filament is not loaded: asked first, then started on the closest spools.
  const [ask, setAsk] = useState<{ text: string; go: () => void } | null>(null);
  const [dragQ, setDragQ] = useState<number | null>(null);
  const [overQ, setOverQ] = useState<number | null>(null);
  const p = snap.data.printers.find((x) => x.id === id)!;
  const live = snap.live[id];
  const cur = snap.data.current[id];
  const st = displayStatus(live, cur);
  const slots = schedule(snap, id, now);
  const queue = snap.data.queues[id] ?? [];
  const qslots = slots.filter((s) => !s.current);
  const shelf = snap.data.shelves.find((s) => s.slots.includes(id));
  const total = queue.reduce((a, j) => a + j.minutes, 0);
  const others = snap.data.printers.filter((x) => x.id !== id);
  const pillCls = st === "printing" ? "ok" : st === "error" ? "err" : st === "paused" || st === "finished" ? "warn" : "";
  const nextMissing = queue[0] ? matchFilaments(queue[0], live).filter((m) => !m.slot) : [];

  const run = async (name: string, ...args: unknown[]) => {
    const r = await act(name, ...args);
    return r;
  };
  /** Starts the next plate, asking first when its filament is not loaded. */
  const startNext = (start: (anyFilament: boolean) => void) => {
    const warn = queue[0] ? filamentWarning(queue[0], live) : null;
    if (warn) setAsk({ text: `${warn} on ${p.name}. Start ${queue[0].name} anyway?`, go: () => start(true) });
    else start(false);
  };
  const askBlock = ask && (
    <div className="confirm warn">{ask.text}
      <button className="btn sm pri" onClick={() => { const go = ask.go; setAsk(null); go(); }}>Start anyway</button>
      <button className="btn sm" onClick={() => setAsk(null)}>Cancel</button>
    </div>
  );

  let liveBlock: React.ReactNode;
  if (st === "printing" || st === "paused" || st === "preparing" || st === "error") {
    const prog = live?.progress ?? 0;
    const name = cur?.name ?? live?.jobName ?? "Print started on the printer";
    liveBlock = (
      <>
        {st === "error" && <div className="banner err"><b>Needs attention</b>{live?.error ?? "The printer stopped."} Check the bed, then resume or stop.</div>}
        {st === "paused" && <div className="banner warn"><b>Paused</b>The nozzle cools while paused.</div>}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <div><div className="muted">{st === "preparing" ? "Heating up" : "Time left"}</div><div className="big-time">{hms(live?.remainingSec)}</div></div>
          <div style={{ textAlign: "right" }}><div className="muted">Done at</div><div className="num" style={{ fontSize: 18 }}>{clock(slots[0]?.end, now)}</div></div>
        </div>
        <div className="bar" style={{ height: 6 }}><i style={{ width: `${(prog * 100).toFixed(1)}%`, background: st === "error" ? "var(--err)" : st === "paused" ? "var(--warn)" : "var(--accent)" }} /></div>
        <div className="cur">
          {cur ? <PlateThumb job={cur} /> : <span className="thumb" />}
          <div style={{ minWidth: 0 }}>
            <div className="cur-name">{name}</div>
            <div className="cur-meta">{cur?.ref && <><span className="ref">{cur.ref}</span> · </>}{live?.layer != null && live.totalLayers ? <>layer <span className="num">{live.layer}</span>/{live.totalLayers}</> : `${Math.round(prog * 100)}%`}{cur && ` · ${cur.grams} g`}</div>
          </div>
        </div>
        <div className="kv">
          <div><span>Nozzle</span><b>{Math.round(live?.nozzle.current ?? 0)}/{Math.round(live?.nozzle.target ?? 0)}°</b></div>
          <div><span>Bed</span><b>{Math.round(live?.bed.current ?? 0)}/{Math.round(live?.bed.target ?? 0)}°</b></div>
          <div><span>Progress</span><b>{Math.round(prog * 100)}%</b></div>
        </div>
        {confirmStop ? (
          <div className="confirm">Stop this print? The plate is lost.
            <button className="btn sm danger solid" onClick={async () => { setConfirmStop(false); if ((await run("stop", id)) !== undefined) toast(`${p.name} stopped`); }}>Stop print</button>
            <button className="btn sm" onClick={() => setConfirmStop(false)}>Keep printing</button>
          </div>
        ) : (
          <div className="row">
            {st === "printing" || st === "preparing"
              ? <button className="btn" onClick={() => run("pause", id)}>Pause</button>
              : <button className="btn pri" onClick={() => run("resume", id)}>Resume</button>}
            <button className="btn danger" onClick={() => setConfirmStop(true)}>Stop</button>
          </div>
        )}
      </>
    );
  } else if (st === "finished") {
    liveBlock = (
      <>
        <div className="banner warn"><b>{cur?.name ?? live?.jobName ?? "The print"} is finished</b>Take the parts off and confirm the bed is clear.{queue[0] ? ` Then ${queue[0].name} starts.` : ""}</div>
        {cur && <div className="cur"><PlateThumb job={cur} /><div><div className="cur-name">{cur.name}</div><div className="cur-meta">{cur.ref && <><span className="ref">{cur.ref}</span> · </>}{cur.grams} g</div></div></div>}
        {nextMissing.length > 0 && <div className="banner warn">{nextMissing.map((m) => m.problem).join(". ")}.</div>}
        {askBlock || (
          <div className="row">
            {queue.length > 0 && <button className="btn pri" onClick={() => startNext(async (anyFilament) => { if ((await run("clearBed", id, true, { anyFilament })) !== undefined) toast(`${p.name} started ${queue[0].name}`); })}>Bed is clear, start next</button>}
            <button className={`btn ${queue.length ? "" : "pri"}`} onClick={() => run("clearBed", id, false)}>Bed is clear{queue.length ? ", don't start" : ""}</button>
          </div>
        )}
      </>
    );
  } else if (st === "idle") {
    liveBlock = (
      <>
        <div className="banner neutral"><b>Idle</b>{queue.length ? `${queue.length} plate${queue.length > 1 ? "s" : ""} waiting.` : "Nothing queued. Add a plate or take one from the inbox."}</div>
        {nextMissing.length > 0 && !ask && <div className="banner warn"><b>Check the filament</b>{nextMissing.map((m) => m.problem).join(". ")}.</div>}
        {queue.length > 0 && (askBlock || <div className="row"><button className="btn pri" onClick={() => startNext(async (anyFilament) => { if ((await run("startNext", id, { anyFilament })) !== undefined) toast(`${p.name} started ${queue[0].name}`); })}>Start {queue[0].name}</button></div>)}
      </>
    );
  } else {
    liveBlock = <div className="banner neutral"><b>Offline</b>{live?.error ?? "Not connected."} The queue is kept.</div>;
  }

  const amsSlots = (live?.ams ?? []).flatMap((u) => u.slots);
  const allSlots = live?.external ? [...amsSlots, live.external] : amsSlots;

  return (
    <>
      <div className="insp-sec">
        <div className="insp-head">
          <div style={{ minWidth: 0 }}><h2>{p.name}</h2><div className="model">{p.model}{shelf ? ` · ${shelf.name.split(" · ")[0]}, slot ${shelf.slots.indexOf(id) + 1}` : ""}</div></div>
          <span className={`pill ${pillCls}`}>{STATUS_LABEL[st]}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="conn"><i className={`dot ${st === "offline" ? "off" : ""}`} />{p.driver === "bambu" || p.driver === "anycubic" ? `LAN · ${p.host ?? "no address"}` : p.driver === "simulator" ? "Simulated printer" : p.driver}</span>
          <button className="btn sm ghost" onClick={() => onEdit(id)}>{Icon.edit}Printer settings</button>
        </div>
      </div>
      <div className="insp-sec">{liveBlock}</div>
      {allSlots.length > 0 && (
        <div className="insp-sec">
          <div className="qhead"><h3>Filament</h3><span>{live?.ams.length ? `AMS${live.ams[0].humidity != null ? ` · ${live.ams[0].humidity}% humidity` : ""}` : "Spool"}</span></div>
          <div className="ams">
            {allSlots.map((s) => (
              <div key={`${s.unit}:${s.slot}`} className={live?.activeSlot === `${s.unit}:${s.slot}` ? "active" : ""} title={s.color ?? "Empty"}>
                <i className={s.color ? "" : "empty"} style={{ background: s.color ?? undefined }} />
                <span>{s.unit < 0 ? "Ext" : s.unit * 4 + s.slot + 1} · {s.material?.split(" ")[0] ?? "–"}</span>
                <span className="left">{s.remainPct != null ? `${s.remainPct}%` : " "}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="insp-sec">
        <div className="qhead"><h3>Upcoming plates</h3><span>{queue.length ? `${dur(total * 60)} · free ${clock(slots[slots.length - 1]?.end, now)}` : ""}</span></div>
        <div className="qlist">
          {queue.map((job, i) => {
            const slot = qslots.find((s) => s.job.id === job.id);
            const missing = matchFilaments(job, live).filter((m) => !m.slot);
            return (
              <div key={job.id} className={`qi ${dragQ === i ? "drag" : ""} ${overQ === i ? "over" : ""} ${flash === job.id ? "flash" : ""}`} draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragQ(i); }}
                onDragOver={(e) => { if (dragQ !== null) { e.preventDefault(); setOverQ(i); } }}
                onDragLeave={() => setOverQ(null)}
                onDrop={(e) => { e.preventDefault(); if (dragQ !== null && dragQ !== i) void act("reorder", id, dragQ, i); setDragQ(null); setOverQ(null); }}
                onDragEnd={() => { setDragQ(null); setOverQ(null); }}>
                <span className="grip" title="Drag to reorder">⠿</span>
                <PlateThumb job={job} />
                <div style={{ minWidth: 0 }}>
                  <div className="qi-name">{job.name}</div>
                  <div className="qi-meta">
                    {job.ref && <span className="ref">{job.ref}</span>}{dur(job.minutes * 60)} · {job.grams} g
                    {job.filaments.map((f, k) => <i key={k} className="sw" style={{ background: f.color }} title={f.material} />)}
                    {job.source === "estimate" && <span className="tag-est">estimate</span>}
                  </div>
                  <div className="qi-when">{st === "offline" ? "waits for the printer" : slot ? `${clock(slot.start, now)} → ${clock(slot.end, now)}` : "does not fit in working hours"}</div>
                  {missing.length > 0 && st !== "offline" && <div className="qi-warn">{Icon.warn} {missing[0].problem}</div>}
                </div>
                <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                  <div className="qi-acts">
                    {onEditPlate && job.project && <button className="btn sm" title="Open this plate in Prepare to change it" onClick={() => onEditPlate(job)}>{Icon.edit}Edit</button>}
                    <button className="icon-btn" title="Duplicate: print this plate once more" aria-label="Duplicate" onClick={async () => { if ((await act("duplicateQueued", id, i, 1)) !== undefined) toast(`${job.name} added once more`); }}>{Icon.copy}</button>
                    <button className="icon-btn" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => act("reorder", id, i, i - 1)}>{Icon.up}</button>
                    <button className="icon-btn" title="Move down" aria-label="Move down" disabled={i === queue.length - 1} onClick={() => act("reorder", id, i, i + 1)}>{Icon.down}</button>
                    <button className="icon-btn" title="Remove from queue" aria-label="Remove from queue" onClick={async () => { await act("dequeue", id, i); toast(`${job.name} removed from ${p.name}`); }}>{Icon.x}</button>
                  </div>
                  <select className="movesel" aria-label="Move to another printer" value="" onChange={async (e) => {
                    const to = others.find((o) => o.id === e.target.value);
                    if (to) { await act("transfer", id, i, to.id); toast(`${job.name} moved to ${to.name}`); }
                  }}>
                    <option value="">Move to…</option>
                    {others.filter((o) => !wrongPrinter(job, o)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
          {!queue.length && <div className="qempty">No plates queued for {p.name}.</div>}
        </div>
        <div className="row"><button className="btn pri" onClick={() => onAddPlate(id)}>{Icon.plus}Add plate</button></div>
      </div>
    </>
  );
}
