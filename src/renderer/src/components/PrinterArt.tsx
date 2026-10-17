import type { LiveState, PlateJob, PrinterConfig } from "../../../core/types";

// OrcaSlicer's pictures of the printer models OPF lists, copied by scripts/printer-pictures.cjs and named after the
// model: "Bambu Lab A1 mini" is assets/printers/bambu-lab-a1-mini.png.
const PICTURES = import.meta.glob<string>("../assets/printers/*.png", { eager: true, query: "?url", import: "default" });

/** The picture of a printer model, or null when OPF has none for it. */
export function printerPicture(model: string): string | null {
  const slug = model.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return PICTURES[`../assets/printers/${slug}.png`] ?? null;
}

/**
 * The printer as it looks: its model's picture with the AMS spools in their real colours, or for a model without
 * a picture a small drawing (enclosure or open frame, spools, the part growing).
 */
export function PrinterArt({ printer, live, job }: { printer: PrinterConfig; live?: LiveState; job: PlateJob | null }) {
  const prog = live?.progress ?? 0;
  const running = live && ["printing", "paused", "error", "preparing"].includes(live.status);
  const objH = job && running ? Math.max(2, prog * 22) : live?.status === "finished" || (job && !running) ? 22 : 0;
  const partColor = job?.filaments[0]?.color ?? "#8E9399";
  const slots = (live?.ams?.[0]?.slots ?? []).slice(0, 4);
  const picture = printerPicture(printer.model);
  if (picture) {
    return (
      <span className="pp">
        <img src={picture} alt="" draggable={false} />
        {slots.length > 1 && (
          <span className="pp-ams" aria-hidden="true">
            {slots.map((s, i) => <i key={i} className={s.color ? "" : "empty"} style={s.color ? { background: s.color } : undefined} />)}
          </span>
        )}
      </span>
    );
  }
  const spools = slots.length > 1 && (
    <>
      <rect x="22" y="3" width="66" height="16" rx="3" fill="#3b4045" stroke="#565c61" />
      {slots.map((s, i) => (
        <circle key={i} cx={30 + i * 17} cy="11" r="4.6" fill={s.color ?? "transparent"} stroke={s.color ? "rgba(0,0,0,.4)" : "#6d747a"} strokeDasharray={s.color ? undefined : "2 2"} />
      ))}
    </>
  );
  const led = live?.status === "error" ? "#ef4b4f" : live?.status === "printing" ? "#00ae42" : live?.status === "paused" || live?.status === "finished" ? "#f2a33a" : "#5a6066";
  const headY = (1 - prog) * 26;

  if (printer.enclosed !== false) {
    return (
      <svg viewBox="0 0 110 100" aria-hidden="true">
        {spools}
        <rect x="10" y="22" width="90" height="74" rx="6" fill="#2b2f33" stroke="#4d5358" strokeWidth="1.5" />
        <rect x="17" y="29" width="76" height="54" rx="3" fill="#15181a" stroke="#3d4247" />
        <rect x="22" y={33 + headY} width="66" height="3" fill="#6d747a" />
        <rect x="49" y={30 + headY} width="12" height="9" rx="1.5" fill="#9aa1a6" />
        <rect x="22" y="74" width="66" height="4" fill="#5a6066" />
        {objH > 0 && <rect x="44" y={74 - objH} width="22" height={objH} rx="1.5" fill={partColor} />}
        <rect x="40" y="87" width="30" height="4" rx="2" fill={led} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 110 100" aria-hidden="true">
      {spools}
      <rect x="20" y="24" width="6" height="66" rx="2" fill="#4d5358" />
      <rect x="84" y="24" width="6" height="66" rx="2" fill="#4d5358" />
      <rect x="20" y="24" width="70" height="5" rx="2" fill="#4d5358" />
      <rect x="20" y={36 + headY * 1.15} width="70" height="3" fill="#6d747a" />
      <rect x="47" y={33 + headY * 1.15} width="14" height="10" rx="1.5" fill="#9aa1a6" />
      <rect x="12" y="84" width="86" height="5" rx="1.5" fill="#5a6066" />
      {objH > 0 && <rect x="44" y={84 - objH} width="22" height={objH} rx="1.5" fill={partColor} />}
      <rect x="8" y="90" width="94" height="6" rx="2" fill="#3b4045" />
      <circle cx="98" cy="30" r="2.5" fill={led} />
    </svg>
  );
}

/** The plate's top view if it has one, otherwise its filament colours. */
export function PlateThumb({ job }: { job: PlateJob }) {
  if (job.thumbnail) return <img className="thumb" src={job.thumbnail} alt="" />;
  return (
    <span className="thumb thumb-fil" aria-hidden="true">
      {job.filaments.length ? job.filaments.map((f, i) => <i key={i} style={{ background: f.color }} />) : <i />}
    </span>
  );
}
