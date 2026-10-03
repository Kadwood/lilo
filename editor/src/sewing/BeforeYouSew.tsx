import { useId, useMemo, useState } from "react";
import { DEFAULT_SPM, recommendedSpeed, type Design, type Hoop, type SewingSetup, type Thread } from "@lilo/engine/light";
import { useHoop } from "../hoops/autoPick";
import { fmtSize } from "../hoops/format";
import { formatDuration } from "../state/player";
import { useEditor } from "../state/store";
import { useResolvedSewing } from "./useSewing";

/** The threads in the order they are sewn: one entry per colour block (a thread that comes back is listed again). */
export function threadsInSewingOrder(design: Design | null): Thread[] {
  if (!design) return [];
  const byId = new Map(design.threads.map((t) => [t.id, t]));
  const out: Thread[] = [];
  let last: string | null = null;
  for (const o of design.objects) {
    if (o.visible === false || o.threadId === last) continue;
    const t = byId.get(o.threadId);
    if (t) out.push(t);
    last = o.threadId;
  }
  return out;
}

export const threadLabel = (t: Thread): string => `${t.brand}${t.line && !/^embroidery$/i.test(t.line) ? ` ${t.line}` : ""} ${t.code} ${t.name}`;

export interface SewFacts {
  stitchCount: number;
  colorChanges: number;
  /** Seconds at `DEFAULT_SPM` (the plan's estimate). */
  estimatedSeconds: number;
}

/** One item in the checklist: a line to tick off. */
export interface SewItem {
  id: string;
  text: string;
  /** A thread: shown with a swatch. */
  hex?: string;
}

/** Everything the card lists, in the order it is listed. Pure so the text copy and the screen cannot differ. */
export function sewItems(setup: SewingSetup, hoop: Hoop, threads: readonly Thread[]): { setup: SewItem[]; hoop: SewItem; threads: SewItem[] } {
  return {
    setup: setup.checklist.map((text, i) => ({ id: `c${i}`, text })),
    hoop: { id: "hoop", text: `Hoop: ${hoop.name}, ${fmtSize(hoop)}. Hoop the fabric and stabiliser together and check the design sits inside the dashed margin.` },
    threads: threads.map((t, i) => ({ id: `t${i}`, text: `${i + 1}. ${threadLabel(t)}`, hex: t.hex })),
  };
}

/** The whole card as plain text, for pasting into a message or a note by the machine. */
export function sewText(args: { name: string; setup: SewingSetup; hoop: Hoop; threads: readonly Thread[]; facts: SewFacts | null }): string {
  const { name, setup, hoop, threads, facts } = args;
  const items = sewItems(setup, hoop, threads);
  const speed = recommendedSpeed(setup.input.fabric, setup.input.threadWeight);
  const lines: string[] = [`Before you sew: ${name || "design"}`, "", `Setup: ${setup.summary}`, ""];
  for (const i of [...items.setup, items.hoop]) lines.push(`[ ] ${i.text}`);
  lines.push("", "Threads, in sewing order:");
  if (items.threads.length === 0) lines.push("(none yet)");
  for (const t of items.threads) lines.push(`[ ] ${t.text}`);
  lines.push("");
  if (facts) lines.push(`Stitches: ${facts.stitchCount.toLocaleString()}. Colour changes: ${facts.colorChanges}. About ${formatDuration(facts.estimatedSeconds)} at ${DEFAULT_SPM} stitches a minute.`);
  lines.push(`Recommended speed for this fabric: ${speed.minSpm}-${speed.maxSpm} stitches a minute. ${speed.note}`);
  return lines.join("\n");
}

/** "Before you sew": tick-off checklist for the setup, hoop and threads, with the stitch count, time and speed. Ticks are not saved. */
export function BeforeYouSew() {
  const { state } = useEditor();
  const setup = useResolvedSewing();
  const hoop = useHoop();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const uid = useId();
  const design = state.design;
  const stats = state.planResult?.stats ?? null;
  const threads = useMemo(() => threadsInSewingOrder(design), [design]);
  const items = useMemo(() => sewItems(setup, hoop, threads), [setup, hoop, threads]);
  const speed = recommendedSpeed(setup.input.fabric, setup.input.threadWeight);
  const facts: SewFacts | null = stats ? { stitchCount: stats.stitchCount, colorChanges: stats.colorChanges, estimatedSeconds: stats.estimatedSeconds } : null;
  const all = [...items.setup, items.hoop, ...items.threads];
  const done = all.filter((i) => ticked.has(i.id)).length;

  const toggle = (id: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const copy = async () => {
    const text = sewText({ name: state.projectName, setup, hoop, threads, facts });
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };

  const row = (i: SewItem) => (
    <li key={i.id}>
      <label className="sew-item">
        <input type="checkbox" checked={ticked.has(i.id)} onChange={() => toggle(i.id)} />
        {i.hex && <span className="swatch small" style={{ background: i.hex }} aria-hidden="true" />}
        <span>{i.text}</span>
      </label>
    </li>
  );

  return (
    <section className="before-sew" aria-labelledby={`${uid}-title`}>
      <div className="before-sew-head">
        <h3 id={`${uid}-title`}>Before you sew</h3>
        <span className="muted small" aria-live="polite">
          {done} of {all.length} ticked
        </span>
        <span className="spacer" />
        <button onClick={() => void copy()}>Copy as text</button>
      </div>
      {copied && (
        <p className={`small ${copied === "failed" ? "error" : "muted"}`} role="status">
          {copied === "ok" ? "Copied." : "Could not copy: select the list and copy it by hand."}
        </p>
      )}
      <dl className="stats before-sew-stats" aria-label="Sewing facts">
        <div>
          <dt>Stitches</dt>
          <dd>{facts ? facts.stitchCount.toLocaleString() : "…"}</dd>
        </div>
        <div>
          <dt>Time at {DEFAULT_SPM} spm</dt>
          <dd>{facts ? `≈ ${formatDuration(facts.estimatedSeconds)}` : "…"}</dd>
        </div>
        <div>
          <dt>Recommended speed</dt>
          <dd>
            {speed.minSpm}–{speed.maxSpm} spm
          </dd>
        </div>
      </dl>
      <p className="muted small">{speed.note} Speed ranges are rules of thumb: your machine and a test sew-out decide.</p>
      <ul className="sew-list" aria-label="Setup checklist">
        {[...items.setup, items.hoop].map(row)}
      </ul>
      <h4>Threads, in sewing order</h4>
      {items.threads.length === 0 ? (
        <p className="muted small">No threads yet.</p>
      ) : (
        <ul className="sew-list" aria-label="Threads in sewing order">
          {items.threads.map(row)}
        </ul>
      )}
    </section>
  );
}
