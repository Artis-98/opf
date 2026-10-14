import { useEffect, useState, type ReactNode } from "react";
import { useFarm } from "../state";
import { opf } from "../bridge";
import type { DriverKind, PrinterConfig, Settings } from "../../../core/types";
import { Icon } from "../components/icons";
import type { Change } from "../../../preload/api";

function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}>{Icon.x}</button></header>
        <div className="body">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>
  );
}

const MODELS = [
  "Bambu Lab X1 Carbon", "Bambu Lab X1E", "Bambu Lab P1S", "Bambu Lab P1P", "Bambu Lab P2S", "Bambu Lab A1", "Bambu Lab A1 mini",
  "Bambu Lab H2D", "Bambu Lab H2S", "Prusa MK4S", "Prusa Core One", "Prusa XL", "Voron 2.4 350", "Creality K1",
];

const DRIVERS: { kind: DriverKind; label: string; ready: boolean }[] = [
  { kind: "bambu", label: "Bambu Lab, local network", ready: true },
  { kind: "simulator", label: "Simulated printer (for trying OPF)", ready: true },
  { kind: "moonraker", label: "Klipper / Moonraker (coming)", ready: false },
  { kind: "prusalink", label: "PrusaLink (coming)", ready: false },
  { kind: "octoprint", label: "OctoPrint (coming)", ready: false },
];

export function PrinterDialog({ id, place, onClose, onSaved }: { id: string | null; place?: { shelfId: string; slot: number }; onClose: () => void; onSaved: (id: string) => void }) {
  const { snap, act, toast } = useFarm();
  const existing = id ? snap.data.printers.find((p) => p.id === id) : undefined;
  const [f, setF] = useState<Omit<PrinterConfig, "id">>(() => existing ? { ...existing } : {
    name: `Printer ${snap.data.printers.length + 1}`, model: "Bambu Lab P1S", driver: "bambu", host: "", serial: "", accessCode: "", enclosed: true, slicing: null,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const slicing = f.slicing ?? { machine: "", process: "", filaments: [] };
  const setSlicing = (patch: Partial<typeof slicing>) => set("slicing", { ...slicing, ...patch });
  const pick = async (apply: (path: string) => void) => {
    const p = await opf.pickProfile?.();
    if (p) apply(p);
  };

  const save = async () => {
    if (!f.name.trim()) return toast("Give the printer a name.", true);
    if (f.driver === "bambu" && (!f.host?.trim() || !f.serial?.trim() || !f.accessCode?.trim())) return toast("A Bambu printer needs its IP address, serial number and access code.", true);
    const clean = { ...f, name: f.name.trim(), host: f.host?.trim(), serial: f.serial?.trim().toUpperCase(), accessCode: f.accessCode?.trim(), slicing: slicing.machine && slicing.process && slicing.filaments.length ? slicing : null };
    if (existing) {
      await act("updatePrinter", existing.id, clean);
      onSaved(existing.id);
    } else {
      const newId = await act<string>("addPrinter", clean, place);
      if (newId) onSaved(newId);
    }
    onClose();
  };

  return (
    <Dialog title={existing ? `${existing.name} settings` : "Add a printer"} onClose={onClose} footer={
      <>
        {existing && (confirmDelete
          ? <><span className="muted">Its queue moves to the inbox.</span><button className="btn danger solid" onClick={async () => { await act("removePrinter", existing.id); onClose(); }}>Remove {existing.name}</button></>
          : <button className="btn danger" onClick={() => setConfirmDelete(true)}>Remove printer</button>)}
        <span className="sp" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" onClick={save}>{existing ? "Save" : "Add printer"}</button>
      </>
    }>
      <div className="fg2">
        <div className="fg"><label htmlFor="p-name">Name</label><input id="p-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="fg"><label htmlFor="p-model">Model</label><input id="p-model" className="input" list="opf-models" value={f.model} onChange={(e) => set("model", e.target.value)} /><datalist id="opf-models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist></div>
      </div>
      <div className="fg">
        <label htmlFor="p-driver">Connection</label>
        <select id="p-driver" className="input" value={f.driver} onChange={(e) => set("driver", e.target.value as DriverKind)}>
          {DRIVERS.map((d) => <option key={d.kind} value={d.kind}>{d.label}</option>)}
        </select>
        {!DRIVERS.find((d) => d.kind === f.driver)?.ready && <span className="help">OPF cannot talk to these yet. The printer shows as offline and its queue is kept.</span>}
      </div>
      {f.driver === "bambu" && (
        <>
          <div className="fg2">
            <div className="fg"><label htmlFor="p-host">IP address</label><input id="p-host" className="input mono" placeholder="192.168.1.42" value={f.host ?? ""} onChange={(e) => set("host", e.target.value)} /></div>
            <div className="fg"><label htmlFor="p-code">LAN access code</label><input id="p-code" className="input mono" placeholder="8 characters" value={f.accessCode ?? ""} onChange={(e) => set("accessCode", e.target.value)} /></div>
          </div>
          <div className="fg"><label htmlFor="p-serial">Serial number</label><input id="p-serial" className="input mono" placeholder="01P00A000000000" value={f.serial ?? ""} onChange={(e) => set("serial", e.target.value)} />
            <span className="help">All three are on the printer's screen: Settings → Network (IP, access code) and Settings → Device (serial). Reading status works in LAN mode. To start and stop prints from OPF, also turn on Developer Mode in the printer's LAN settings.</span>
          </div>
        </>
      )}
      <label className="check"><input type="checkbox" checked={f.enclosed !== false} onChange={(e) => set("enclosed", e.target.checked)} />Enclosed printer</label>

      <div className="section-title">Slicing profiles</div>
      <span className="help muted">In Bambu Studio or OrcaSlicer, pick this printer, your process and filament, then File → Export → Export Configs. Choose the exported files here.</span>
      {(["machine", "process"] as const).map((k) => (
        <div className="fg" key={k}>
          <label htmlFor={`p-${k}`}>{k === "machine" ? "Printer profile" : "Process profile"}</label>
          <div className="secret">
            <input id={`p-${k}`} className="input" placeholder="path to .json" value={slicing[k]} onChange={(e) => setSlicing({ [k]: e.target.value })} />
            {opf.pickProfile && <button className="btn" onClick={() => pick((p) => setSlicing({ [k]: p }))}>Choose…</button>}
          </div>
        </div>
      ))}
      <div className="fg">
        <label htmlFor="p-fil">Filament profiles</label>
        <div className="secret">
          <input id="p-fil" className="input" placeholder="one or more .json, separated by ;" value={slicing.filaments.join(";")} onChange={(e) => setSlicing({ filaments: e.target.value.split(";").map((s) => s.trim()).filter(Boolean) })} />
          {opf.pickProfile && <button className="btn" onClick={() => pick((p) => setSlicing({ filaments: [...slicing.filaments, p] }))}>Add…</button>}
        </div>
      </div>
    </Dialog>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { snap, act, toast } = useFarm();
  const [s, setS] = useState<Settings>(() => structuredClone(snap.data.settings));
  const [src, setSrc] = useState(() => s.inboxSource ?? { url: "", token: "", pollSec: 60 });
  const [confirmDemo, setConfirmDemo] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const days = s.workDays.padEnd(7, "1");

  const save = async () => {
    if (s.workEnd <= s.workStart) return toast("Closing time must be after opening time.", true);
    await act("updateSettings", { ...s, inboxSource: src.url.trim() ? { ...src, url: src.url.trim() } : null });
    toast("Settings saved");
    onClose();
  };

  return (
    <Dialog title="Settings" onClose={onClose} footer={
      <>
        {confirmDemo
          ? <><span className="muted">Your printers and queues are replaced.</span><button className="btn danger solid" onClick={async () => { await opf.loadDemo(); onClose(); }}>Replace with the demo</button></>
          : <button className="btn ghost" onClick={() => setConfirmDemo(true)}>Replace my farm with the demo…</button>}
        <span className="sp" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" onClick={save}>Save</button>
      </>
    }>
      <div className="section-title">Working hours</div>
      <span className="help muted">Prints run unattended, but the next plate needs someone to take the parts off. OPF only starts plates inside these hours, so the dates it gives are real.</span>
      <div className="fg2">
        <div className="fg"><label htmlFor="s-open">Someone is in from</label><select id="s-open" className="input" value={s.workStart} onChange={(e) => set("workStart", +e.target.value)}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></div>
        <div className="fg"><label htmlFor="s-close">until</label><select id="s-close" className="input" value={s.workEnd} onChange={(e) => set("workEnd", +e.target.value)}>{Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></div>
      </div>
      <div className="days" role="group" aria-label="Working days">
        {DAYS.map((d, i) => (
          <label key={d} className={days[i] === "1" ? "on" : ""}>
            <input type="checkbox" checked={days[i] === "1"} onChange={(e) => set("workDays", days.slice(0, i) + (e.target.checked ? "1" : "0") + days.slice(i + 1))} />{d}
          </label>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={s.overnightOk} onChange={(e) => set("overnightOk", e.target.checked)} />Prints may keep running after everyone has left</label>
      <div className="fg2">
        <div className="fg"><label htmlFor="s-change">Bed change, minutes</label><input id="s-change" type="number" min={0} max={120} className="input" value={s.changeoverMin} onChange={(e) => set("changeoverMin", Math.max(0, +e.target.value || 0))} /></div>
      </div>

      <div className="section-title">Test printers</div>
      <span className="help muted">Simulated printers sit next to your real ones and behave like them, without printing anything. Use them to try the queue, plates and new features.</span>
      <div className="row">
        <button className="btn" onClick={async () => { const ids = await act<string[]>("addTestPrinters"); if (ids) { toast("Added A1 TEST and A1 mini TEST on the Test shelf"); onClose(); } }}>{Icon.plus}Add an A1 and A1 mini test printer</button>
      </div>
      <div className="fg2">
        <div className="fg">
          <label htmlFor="s-simspeed">Test printers run at</label>
          <select id="s-simspeed" className="input" value={s.simSpeed} onChange={(e) => set("simSpeed", +e.target.value)}>
            <option value={1}>Real time</option>
            <option value={10}>10× faster</option>
            <option value={60}>60× faster (an hour takes a minute)</option>
          </select>
        </div>
      </div>

      <div className="section-title">Slicer</div>
      <div className="fg">
        <label htmlFor="s-slicer">Bambu Studio or OrcaSlicer program</label>
        <input id="s-slicer" className="input" placeholder={snap.slicer.found ? snap.slicer.path ?? "" : "Found automatically when installed in the usual place"} value={s.slicerPath ?? ""} onChange={(e) => set("slicerPath", e.target.value || null)} />
        <span className="help">{snap.slicer.found ? `Using ${snap.slicer.name}: ${snap.slicer.path}` : opf.isDemo ? "The browser demo cannot run a slicer." : "No slicer found yet."}</span>
      </div>

      <div className="section-title">Receive work</div>
      <div className="fg">
        <label htmlFor="s-src">Fetch parts from (for example admin.iiteg.com)</label>
        <input id="s-src" className="input" placeholder="https://admin.iiteg.com/api/opf/queue" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} />
      </div>
      <div className="fg2">
        <div className="fg"><label htmlFor="s-srctoken">Token</label><input id="s-srctoken" className="input mono" value={src.token} onChange={(e) => setSrc({ ...src, token: e.target.value })} /></div>
        <div className="fg"><label htmlFor="s-poll">Check every, seconds</label><input id="s-poll" type="number" min={15} className="input" value={src.pollSec} onChange={(e) => setSrc({ ...src, pollSec: Math.max(15, +e.target.value || 60) })} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={s.api.enabled} onChange={(e) => set("api", { ...s.api, enabled: e.target.checked })} />Local API on port
        <input type="number" className="input" style={{ width: 90 }} value={s.api.port} onChange={(e) => set("api", { ...s.api, port: +e.target.value || 7878 })} aria-label="API port" />
      </label>
      <div className="fg">
        <label htmlFor="s-token">API token</label>
        <div className="secret">
          <input id="s-token" className="input" readOnly value={s.api.token} />
          <button className="btn" onClick={() => { navigator.clipboard.writeText(s.api.token).then(() => toast("Token copied"), () => toast("Select the token and copy it", true)); }}>Copy</button>
          <button className="btn" onClick={() => set("api", { ...s.api, token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) })}>New</button>
        </div>
        <span className="help">Other programs send parts to OPF with POST http://127.0.0.1:{s.api.port}/api/v1/inbox and this token. See the README.</span>
      </div>
    </Dialog>
  );
}

export function WhatsNewDialog({ changes, onClose }: { changes: Change[]; onClose: () => void }) {
  return (
    <Dialog title="What's new in OPF" onClose={onClose} footer={<button className="btn pri" onClick={onClose}>Got it</button>}>
      <p className="muted" style={{ margin: 0 }}>Changes since you last opened OPF, newest first.</p>
      <ul className="changes">
        {changes.map((c, i) => (
          <li key={i}><b>{c.subject}</b>{c.body && <span>{c.body}</span>}</li>
        ))}
      </ul>
    </Dialog>
  );
}
