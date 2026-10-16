import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { opf } from "./bridge";
import type { Snapshot } from "../../core/types";

interface Toast { id: number; text: string; err: boolean }

interface Ctx {
  snap: Snapshot | null;
  /** Runs a farm action; shows its error as a toast and returns undefined when it fails. */
  act: <T = unknown>(name: string, ...args: unknown[]) => Promise<T | undefined>;
  toast: (text: string, err?: boolean) => void;
}

const FarmCtx = createContext<Ctx | null>(null);

export function FarmProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);

  useEffect(() => {
    let alive = true;
    void opf.snapshot().then((s) => alive && setSnap(s));
    const off = opf.onUpdate((s) => setSnap(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const toast = useCallback((text: string, err = false) => {
    const id = ++n.current;
    setToasts((t) => [...t.slice(-2), { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 6000 : 3000);
  }, []);

  const act = useCallback(async <T,>(name: string, ...args: unknown[]): Promise<T | undefined> => {
    const r = await opf.act(name, ...args);
    if (!r.ok) {
      toast(r.error, true);
      return undefined;
    }
    return r.value as T;
  }, [toast]);

  return (
    <FarmCtx.Provider value={{ snap, act, toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.err ? "err" : ""}`}>{t.text}</div>)}
      </div>
    </FarmCtx.Provider>
  );
}

export function useFarm(): Ctx & { snap: Snapshot } {
  const c = useContext(FarmCtx);
  if (!c || !c.snap) throw new Error("useFarm outside a loaded farm");
  return c as Ctx & { snap: Snapshot };
}

export function useFarmMaybe(): Ctx | null {
  return useContext(FarmCtx);
}

/** Re-render every second, for countdowns between printer updates. */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
