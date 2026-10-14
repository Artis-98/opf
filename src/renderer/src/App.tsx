import { useCallback, useEffect, useState } from "react";
import { FarmProvider, useFarm, useFarmMaybe } from "./state";
import { opf, printerFromAddress } from "./bridge";
import { displayStatus, FarmView } from "./views/Farm";
import { TimelineView } from "./views/Timeline";
import { emptyPrep, newPlate, PrepareView, type PrepState } from "./views/Prepare";
import { PrinterDialog, SettingsDialog, WhatsNewDialog } from "./views/Dialogs";
import type { Change, UpdateInfo } from "../../preload/api";
import { Icon } from "./components/icons";
import { arrange, loadModel, placeholder, plateSize, type PlateObject } from "./models";
import { matchFilaments } from "../../core/filament";
import type { InboxItem } from "../../core/types";

type View = "farm" | "timeline" | "prepare";

function readTheme(): string {
  try {
    return localStorage.getItem("opf-theme") ?? "dark";
  } catch {
    return "dark";
  }
}

export default function App() {
  return (
    <FarmProvider>
      <Loaded />
    </FarmProvider>
  );
}

function Loaded() {
  const ctx = useFarmMaybe();
  if (!ctx?.snap) return <div className="welcome"><p>Starting OPF…</p></div>;
  return <Shell />;
}

function Shell() {
  const { snap, toast } = useFarm();
  const [view, setView] = useState<View>("farm");
  const [sel, setSel] = useState<string | null>(printerFromAddress);
  const [prep, setPrepState] = useState<PrepState>(() => emptyPrep(null));
  const [printerDialog, setPrinterDialog] = useState<{ id: string | null; place?: { shelfId: string; slot: number } } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [whatsNew, setWhatsNew] = useState<Change[]>([]);

  useEffect(() => {
    void opf.updateState().then(setUpdate);
    void opf.whatsNew().then(setWhatsNew);
    return opf.onUpdateReady(setUpdate);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("opf-theme", theme); } catch { /* not saved, still works */ }
  }, [theme]);

  const setPrep = useCallback((fn: (p: PrepState) => PrepState) => setPrepState(fn), []);

  const live = snap.live;
  const sts = snap.data.printers.map((p) => displayStatus(live[p.id], snap.data.current[p.id]));
  const count = (s: string) => sts.filter((x) => x === s).length;
  const attention = sts.filter((s) => s === "error" || s === "finished" || s === "paused").length;

  const addPlate = (printerId: string) => {
    setPrepState((p) => {
      const sameTarget = p.target === printerId;
      const hasWork = p.plates.some((pl) => pl.objects.length);
      return hasWork && sameTarget ? p : { ...emptyPrep(printerId), layer: p.layer, infill: p.infill, walls: p.walls };
    });
    setView("prepare");
  };

  /** Lay an inbox item out on a plate, on the printer that has its filament loaded and is free soonest. */
  const prepareInbox = async (item: InboxItem) => {
    const want = { filaments: item.color ? [{ color: item.color, material: item.material ?? "PLA", grams: 0 }] : [] };
    const candidates = snap.data.printers.filter((p) => displayStatus(live[p.id], snap.data.current[p.id]) !== "offline");
    const hasIt = (id: string) => want.filaments.length > 0 && matchFilaments(want, live[id]).every((m) => m.slot);
    const selected = sel ? candidates.find((p) => p.id === sel) : undefined;
    const best = (selected && hasIt(selected.id) ? selected : undefined) ?? candidates.find((p) => hasIt(p.id)) ?? selected ?? candidates[0] ?? snap.data.printers[0];
    const color = item.color ?? "#F1F1EE";
    const material = item.material?.split(" ")[0] ?? "PLA";
    let objs: PlateObject[] = [];
    if (item.fileUrl) {
      try {
        const res = await fetch(item.fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const one = await loadModel(item.fileUrl.split("?")[0].split("/").pop() ?? "model.stl", new Uint8Array(await res.arrayBuffer()), color, material);
        for (let i = 0; i < item.qty; i++) objs.push(...one.map((o, k) => (i === 0 ? o : { ...o, id: `${o.id}c${i}${k}` })));
      } catch (e) {
        toast(`Could not download the model for ${item.name}: ${(e as Error).message}. Using placeholders.`, true);
      }
    }
    if (!objs.length) objs = Array.from({ length: item.qty }, (_, i) => placeholder(`${item.name} ${i + 1}`, color, material));
    const size = plateSize(best?.model ?? "");
    setPrepState((p) => ({
      ...emptyPrep(best?.id ?? null),
      layer: p.layer, infill: p.infill, walls: p.walls,
      ref: item.ref, inboxId: item.id,
      plates: [newPlate(`${item.name} ×${item.qty}`, arrange(objs, size))],
    }));
    setView("prepare");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">{Icon.logo}OPF</div>
        <button className={`mode ${view === "farm" ? "on" : ""}`} onClick={() => setView("farm")}>{Icon.farm}Farm</button>
        <button className={`mode ${view === "timeline" ? "on" : ""}`} onClick={() => setView("timeline")}>{Icon.timeline}Timeline</button>
        <button className={`mode ${view === "prepare" ? "on" : ""}`} onClick={() => setView("prepare")}>{Icon.prepare}Prepare</button>
        <div className="summary">
          {update && (
            <button className="chip update" title={update.changes.map((c) => `• ${c.subject}`).join("\n")}
              onClick={() => { toast("Updating. OPF opens again in a moment."); void opf.restart(); }}>
              Update ready · Restart
            </button>
          )}
          {opf.isDemo && <span className="chip demo">Demo · simulated printers</span>}
          <span className="chip"><b>{count("printing") + count("preparing")}</b>printing</span>
          <span className="chip hide-md"><b>{count("idle")}</b>idle</span>
          {attention > 0 && <span className="chip err"><b>{attention}</b>need you</span>}
          <span className="chip hide-md"><b>{count("offline")}</b>offline</span>
          <button className="icon-btn" title="Light or dark" aria-label="Switch light or dark" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{Icon.theme}</button>
          <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>{Icon.settings}</button>
        </div>
      </header>
      <div style={{ minHeight: 0 }}>
        {view === "farm" && (
          <FarmView sel={sel} setSel={setSel} onAddPlate={addPlate} onPrepareInbox={prepareInbox}
            onAddPrinter={(place) => setPrinterDialog({ id: null, place })} onEditPrinter={(id) => setPrinterDialog({ id })} />
        )}
        {view === "timeline" && <TimelineView onPick={(id) => { setSel(id); setView("farm"); }} />}
        {view === "prepare" && (
          <PrepareView prep={{ ...prep, target: prep.target ?? sel ?? snap.data.printers[0]?.id ?? null }} setPrep={setPrep} theme={theme}
            onQueued={(id) => { setSel(id); setView("farm"); }} />
        )}
      </div>
      {printerDialog && <PrinterDialog id={printerDialog.id} place={printerDialog.place} onClose={() => setPrinterDialog(null)} onSaved={(id) => setSel(id)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {whatsNew.length > 0 && <WhatsNewDialog changes={whatsNew} onClose={() => setWhatsNew([])} />}
    </div>
  );
}
