import { useMemo, useRef, useState, type DragEvent } from "react";
import { useFarm, useNow } from "../state";
import { opf } from "../bridge";
import { schedule, displayStatus } from "./Farm";
import { estimatePlate } from "../../../core/estimate";
import { loadedSlots, matchFilaments } from "../../../core/filament";
import type { JobFilament } from "../../../core/types";
import type { SliceResult } from "../../../preload/api";
import { arrange, clone, footprint, loadModel, offPlate, plateSize, toStl, type PlateObject } from "../models";
import { PlateView, type PlateViewHandle } from "../components/PlateView";
import { Icon } from "../components/icons";
import { clock, dur } from "../format";

export interface PrepPlate {
  id: string;
  name: string;
  objects: PlateObject[];
}

export interface PrepState {
  target: string | null;
  ref: string | null;
  inboxId: string | null;
  plates: PrepPlate[];
  cur: number;
  sel: string | null;
  layer: number;
  infill: number;
  walls: number;
  tab: "Quality" | "Strength" | "Support";
  sliced: { plateId: string; result: SliceResult } | null;
}

let pn = 0;
export function newPlate(name = "Plate 1", objects: PlateObject[] = []): PrepPlate {
  return { id: `pl${Date.now().toString(36)}${pn++}`, name, objects };
}

export function emptyPrep(target: string | null): PrepState {
  return { target, ref: null, inboxId: null, plates: [newPlate()], cur: 0, sel: null, layer: 0.2, infill: 15, walls: 2, tab: "Quality", sliced: null };
}

const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC"];

export function PrepareView({ prep, setPrep, theme, onQueued }: {
  prep: PrepState;
  setPrep: (fn: (p: PrepState) => PrepState) => void;
  theme: string;
  onQueued: (printerId: string) => void;
}) {
  const { snap, act, toast } = useFarm();
  const now = useNow(30_000);
  const view = useRef<PlateViewHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sliceError, setSliceError] = useState<string | null>(null);
  const [pos, setPos] = useState<"end" | "next">("end");

  const printers = snap.data.printers;
  const target = printers.find((p) => p.id === prep.target) ?? printers[0];
  const live = target ? snap.live[target.id] : undefined;
  const plate = prep.plates[Math.min(prep.cur, prep.plates.length - 1)];
  const size = plateSize(target?.model ?? "");
  const selObj = plate.objects.find((o) => o.id === prep.sel) ?? null;
  const slots = loadedSlots(live);
  const sliced = prep.sliced && prep.sliced.plateId === plate.id ? prep.sliced.result : null;

  const est = useMemo(
    () => estimatePlate(plate.objects.map((o) => ({ volume: o.volume, area: o.area, height: o.size.z, material: o.material })), { layerHeight: prep.layer, infillPct: prep.infill, wallLoops: prep.walls }),
    [plate.objects, prep.layer, prep.infill, prep.walls],
  );
  const filaments: JobFilament[] = useMemo(() => {
    if (sliced?.filaments.length) return sliced.filaments;
    const by = new Map<string, JobFilament>();
    plate.objects.forEach((o, i) => {
      const k = `${o.color.toUpperCase()}|${o.material}`;
      const f = by.get(k) ?? { color: o.color.toUpperCase(), material: o.material, grams: 0 };
      f.grams += Math.round(est.perObjectGrams[i] ?? 0);
      by.set(k, f);
    });
    return [...by.values()];
  }, [plate.objects, est, sliced]);

  /* ---------- editing the plate ---------- */

  const updatePlate = (fn: (objs: PlateObject[]) => PlateObject[], keepSlice = false) =>
    setPrep((p) => {
      const plates = p.plates.map((pl, i) => (i === p.cur ? { ...pl, objects: fn(pl.objects) } : pl));
      return { ...p, plates, sliced: keepSlice ? p.sliced : null };
    });

  const defaultFil = () => {
    const s = slots[0];
    return { color: s?.color ?? "#F1F1EE", material: s?.material?.split(" ")[0] ?? "PLA" };
  };

  async function addFiles(files: { name: string; data: Uint8Array }[]) {
    if (!files.length) return;
    setBusy("Loading models…");
    const { color, material } = defaultFil();
    const added: PlateObject[] = [];
    for (const f of files) {
      try {
        added.push(...(await loadModel(f.name, f.data, color, material)));
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`, true);
      }
    }
    setBusy(null);
    if (!added.length) return;
    updatePlate((objs) => arrange([...objs, ...added], size));
    setPrep((p) => ({ ...p, sel: added[0].id }));
    toast(`Added ${added.length} object${added.length > 1 ? "s" : ""}`);
  }

  async function importClick() {
    if (opf.openModels) await addFiles(await opf.openModels());
    else fileInput.current?.click();
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    await addFiles(files);
  }

  const assign = (color: string | null, material: string | null, all = false) => {
    if (!color) return;
    const mat = material?.split(" ")[0] ?? "PLA";
    updatePlate((objs) => objs.map((o) => (all || o.id === prep.sel ? { ...o, color: color.toUpperCase(), material: mat } : o)));
  };

  /* ---------- slicing and queueing ---------- */

  async function slice() {
    if (!target || !plate.objects.length) return;
    setSliceError(null);
    setBusy(`Slicing ${plate.name}…`);
    const r = await opf.slice({ printerId: target.id, name: plate.name, objects: plate.objects.map((o) => ({ name: o.name, stl: toStl(o) })) });
    setBusy(null);
    if (r.ok) {
      setPrep((p) => ({ ...p, sliced: { plateId: plate.id, result: r.value } }));
      toast(`Sliced: ${dur(r.value.minutes * 60)}, ${r.value.grams} g`);
    } else {
      setSliceError(r.error);
    }
  }

  async function queue(startNow: boolean) {
    if (!target || !plate.objects.length) return;
    const job = {
      name: plate.name,
      ref: prep.ref,
      minutes: sliced?.minutes ?? est.minutes,
      grams: sliced?.grams ?? est.grams,
      filaments,
      file: sliced?.file ?? null,
      thumbnail: view.current?.thumbnail() ?? null,
      source: sliced ? ("slicer" as const) : ("estimate" as const),
    };
    const id = await act<string>("enqueue", target.id, job, startNow ? "next" : pos);
    if (id === undefined) return;
    if (startNow) {
      const r = await act("startNext", target.id);
      if (r !== undefined) toast(`${target.name} started ${plate.name}`);
    } else {
      toast(`${plate.name} added to ${target.name}`);
    }
    if (prep.inboxId) await act("removeInbox", prep.inboxId);
    const rest = prep.plates.filter((p) => p.id !== plate.id);
    setPrep((p) => ({ ...p, inboxId: null, plates: rest.length ? rest : [newPlate()], cur: 0, sel: null, sliced: null, ref: rest.length ? p.ref : null }));
    if (!rest.length) onQueued(target.id);
  }

  if (!target) {
    return <div className="welcome"><h2>Add a printer first</h2><p>Plates are laid out for a specific printer, so OPF knows the plate size and what filament is loaded.</p></div>;
  }

  const tStatus = displayStatus(live, snap.data.current[target.id]);
  const canStartNow = tStatus === "idle" && !(snap.data.queues[target.id]?.length) && (target.driver === "simulator" || !!sliced);
  const freeAt = (id: string) => { const s = schedule(snap, id, now); return s.length ? s[s.length - 1].end : null; };
  const anyOff = plate.objects.some((o) => offPlate(o, size));
  const needs = matchFilaments({ filaments }, live);

  return (
    <div className="prep">
      <aside className="pset">
        <div className="pgroup">
          <h4>{Icon.printer}Printer</h4>
          <select className="sel" aria-label="Printer to prepare for" value={target.id} onChange={(e) => setPrep((p) => ({ ...p, target: e.target.value, sliced: null }))}>
            {printers.map((p) => {
              const ok = matchFilaments({ filaments }, snap.live[p.id]).every((m) => m.slot);
              const f = freeAt(p.id);
              return <option key={p.id} value={p.id}>{p.name} · {ok && filaments.length ? "filament loaded" : filaments.length ? "load filament" : p.model}{f ? ` · free ${clock(f, now)}` : " · free now"}</option>;
            })}
          </select>
          <div className="muted">{target.model} · plate {size[0]}×{size[1]} mm{target.slicing ? "" : target.driver === "simulator" ? "" : " · no slicing profiles set"}</div>
        </div>

        <div className="pgroup">
          <h4>{Icon.spool}Filament on {target.name}</h4>
          {slots.length ? slots.map((s) => (
            <div className="fil" key={`${s.unit}:${s.slot}`}>
              <i style={{ background: s.color ?? "transparent" }} />
              <span>{s.unit < 0 ? "External" : `Slot ${s.unit * 4 + s.slot + 1}`} · {s.material ?? "unknown"}{s.remainPct != null ? ` · ${s.remainPct}%` : ""}</span>
              <span className="row" style={{ gap: 2 }}>
                <button className="btn sm ghost" disabled={!selObj || !s.color} onClick={() => assign(s.color, s.material)} title="Use for the selected object">Use</button>
                <button className="btn sm ghost" disabled={!plate.objects.length || !s.color} onClick={() => assign(s.color, s.material, true)} title="Use for every object">All</button>
              </span>
            </div>
          )) : <p className="muted" style={{ margin: 0 }}>{target.name} has not reported its filament. Pick a colour for each object below.</p>}
          {selObj && (
            <div className="field" style={{ gridTemplateColumns: "1fr 46px 90px" }}>
              <span>{selObj.name}</span>
              <input type="color" aria-label="Colour of the selected object" value={selObj.color.slice(0, 7)} onChange={(e) => assign(e.target.value, selObj.material)} style={{ padding: 2 }} />
              <select aria-label="Material of the selected object" value={selObj.material} onChange={(e) => assign(selObj.color, e.target.value)}>
                {MATERIALS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="pgroup">
          <h4>{Icon.gear}Process</h4>
          <div className="tabs">
            {(["Quality", "Strength", "Support"] as const).map((t) => <button key={t} className={prep.tab === t ? "on" : ""} onClick={() => setPrep((p) => ({ ...p, tab: t }))}>{t}</button>)}
          </div>
          {prep.tab === "Quality" && (
            <div className="field"><span>Layer height</span>
              <select value={prep.layer} onChange={(e) => setPrep((p) => ({ ...p, layer: +e.target.value, sliced: null }))}>
                {[0.08, 0.12, 0.16, 0.2, 0.24, 0.28].map((v) => <option key={v} value={v}>{v.toFixed(2)} mm</option>)}
              </select>
            </div>
          )}
          {prep.tab === "Strength" && (
            <>
              <div className="field"><span>Wall loops</span><input type="number" min={1} max={10} value={prep.walls} onChange={(e) => setPrep((p) => ({ ...p, walls: Math.max(1, +e.target.value || 1), sliced: null }))} /></div>
              <div className="field"><span>Infill density %</span><input type="number" min={0} max={100} value={prep.infill} onChange={(e) => setPrep((p) => ({ ...p, infill: Math.max(0, Math.min(100, +e.target.value || 0)), sliced: null }))} /></div>
            </>
          )}
          {prep.tab === "Support" && <p className="muted" style={{ margin: 0 }}>Supports, brims and every other setting come from the process profile set for {target.name}.</p>}
          <p className="muted" style={{ margin: 0 }}>These shape the estimate. When you slice, {snap.slicer.name ?? "the slicer"} uses the profiles set in {target.name}'s settings.</p>
        </div>
      </aside>

      <section className="stage">
        <div className="tools">
          <button className="tool" onClick={importClick}>{Icon.file}Add models</button>
          <input ref={fileInput} type="file" accept=".stl,.3mf,.obj" multiple hidden onChange={async (e) => {
            const files = await Promise.all([...(e.target.files ?? [])].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
            e.target.value = "";
            await addFiles(files);
          }} />
          <span className="sep" />
          <button className="tool" disabled={!plate.objects.length} onClick={() => updatePlate((objs) => arrange(objs, size))}>{Icon.grid}Arrange</button>
          <button className="tool" disabled={!selObj} onClick={() => updatePlate((objs) => objs.map((o) => (o.id === prep.sel ? { ...o, rot: (o.rot + Math.PI / 2) % (Math.PI * 2) } : o)))}>{Icon.rotate}Turn 90°</button>
          <button className="tool" disabled={!selObj} onClick={() => updatePlate((objs) => arrange([...objs, clone(selObj!)], size))}>{Icon.copy}Copy</button>
          <button className="tool" disabled={!selObj} aria-label="Delete selected object" onClick={() => { updatePlate((objs) => objs.filter((o) => o.id !== prep.sel)); setPrep((p) => ({ ...p, sel: null })); }}>{Icon.trash}</button>
          <span className="sep" />
          <span className="muted" style={{ whiteSpace: "nowrap" }}>{plate.objects.length} object{plate.objects.length === 1 ? "" : "s"}</span>
        </div>

        <div className={`canvas-wrap ${dragOver ? "dragover" : ""}`} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
          <PlateView ref={view} objects={plate.objects} plate={size} selected={prep.sel} theme={theme}
            onSelect={(id) => setPrep((p) => ({ ...p, sel: id }))}
            onMove={(id, x, y) => updatePlate((objs) => objs.map((o) => (o.id === id ? { ...o, x, y } : o)))} />
          <div className="target-badge"><i className="dot" />Preparing for <b>{target.name}</b>{prep.ref && <span className="ref">{prep.ref}</span>}</div>
          {!plate.objects.length && <div className="drop-hint"><div><b>Drop STL, 3MF or OBJ files here</b>or use Add models above</div></div>}
          {plate.objects.length > 0 && <div className="stage-hint">Drag objects to move them · drag the plate to look around · scroll to zoom</div>}
          {busy && <div className="overlay"><div className="box"><b>{busy}</b><div className="bar" style={{ height: 6 }}><i style={{ width: "60%", background: "var(--accent)" }} /></div></div></div>}
        </div>

        <div className="platebar">
          {prep.plates.map((p, i) => (
            <button key={p.id} className={`ptab ${i === prep.cur ? "on" : ""}`} onClick={() => setPrep((s) => ({ ...s, cur: i, sel: null }))}>{p.name}</button>
          ))}
          <button className="ptab" onClick={() => setPrep((s) => ({ ...s, plates: [...s.plates, newPlate(`Plate ${s.plates.length + 1}`)], cur: s.plates.length, sel: null }))}>{Icon.plus}Plate</button>
          <span style={{ flex: 1 }} />
          <button className="btn pri" disabled={!plate.objects.length || !!busy} onClick={slice}>Slice plate</button>
        </div>
      </section>

      <aside className="pright">
        <div className="insp-sec">
          <div className="qhead"><h3>Plate</h3><span>{prep.ref ? <span className="ref">{prep.ref}</span> : "no order"}</span></div>
          <div className="field wide">
            <input className="input" aria-label="Plate name" value={plate.name} onChange={(e) => setPrep((p) => ({ ...p, plates: p.plates.map((pl, i) => (i === p.cur ? { ...pl, name: e.target.value } : pl)) }))} />
          </div>
          <div className="objs">
            {plate.objects.map((o) => {
              const f = footprint(o);
              const bad = offPlate(o, size);
              return (
                <button key={o.id} className={`obj ${prep.sel === o.id ? "on" : ""} ${bad ? "bad" : ""}`} onClick={() => setPrep((p) => ({ ...p, sel: o.id }))}>
                  <i className="sw" style={{ background: o.color }} />
                  <span className="obj-name">{o.name}{o.placeholder ? " (placeholder)" : ""}</span>
                  <span className="dim">{bad ? "off the plate" : `${Math.round(f.w)}×${Math.round(f.d)}×${Math.round(o.size.z)}`}</span>
                </button>
              );
            })}
            {!plate.objects.length && <p className="muted" style={{ margin: 0 }}>Empty.</p>}
          </div>
          {plate.objects.some((o) => o.placeholder) && <p className="muted" style={{ margin: 0 }}>Placeholders stand in for parts without a model file. Add the real model before slicing.</p>}
        </div>

        <div className="insp-sec">
          <div className="qhead"><h3>Result</h3>{sliced ? <span className="tag-real">sliced by {snap.slicer.name ?? "slicer"}</span> : <span className="tag-est">estimate</span>}</div>
          <div className="res">
            <div><span>Print time</span><b>{dur((sliced?.minutes ?? est.minutes) * 60)}</b></div>
            <div><span>Filament</span><b>{sliced?.grams ?? est.grams} g</b></div>
          </div>
          <div className="usage">
            {filaments.map((f, i) => {
              const m = needs[i];
              return (
                <div key={i}><i className="sw" style={{ background: f.color }} /><span>{f.material} {m?.slot ? <span className="tag-real">loaded</span> : <span className="tag-est">not loaded</span>}</span><span className="num">{f.grams} g</span></div>
              );
            })}
          </div>
          {sliceError && <div className="banner warn">{sliceError}</div>}
          {anyOff && <div className="banner err">Some objects are off the plate. Move them or press Arrange.</div>}
          <div className="field" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <span>Position</span>
            <select value={pos} onChange={(e) => setPos(e.target.value as "end" | "next")}>
              <option value="end">End of queue</option>
              <option value="next">Next up</option>
            </select>
          </div>
          <button className="btn pri" disabled={!plate.objects.length || anyOff} onClick={() => queue(false)}>Add to {target.name} queue</button>
          {canStartNow && <button className="btn" disabled={!plate.objects.length || anyOff} onClick={() => queue(true)}>Send to {target.name} and start</button>}
          {!sliced && target.driver !== "simulator" && <p className="muted" style={{ margin: 0 }}>A plate queued with an estimate is scheduled now, and has to be sliced before it can be sent to the printer.</p>}
        </div>
      </aside>
    </div>
  );
}
