import { useEffect, useRef } from "react";
import { setHoopView } from "../state/hoopViewStore";
import { useEditor } from "../state/store";
import { WORKFLOW, type WorkflowStep } from "./data";
import { openHelp, resetMilestones, setSewingOpen, setStepperTip, useGuide } from "./guideStore";
import { currentStep, workflowTicks } from "./workflow";

/**
 * The always-visible strip at the top of the editor: Get a design, Size and hoop, Stitches, Preview, Send.
 * Each step ticks itself from real state (see `workflowTicks`). A click opens the relevant panel and a tip
 * card from `docs/guide/workflow.json`.
 */
export function WorkflowStepper() {
  const { state, actions } = useEditor();
  const previewed = useGuide((s) => s.previewed);
  const exported = useGuide((s) => s.exported);
  const tipId = useGuide((s) => s.stepperTip);
  const root = useRef<HTMLElement>(null);

  const ticks = workflowTicks({ design: state.design, planResult: state.planResult, previewed, exported });
  const now = currentStep(ticks, WORKFLOW.map((s) => s.id));
  const hasObjects = (state.design?.objects.length ?? 0) > 0;

  // a new, empty design starts the preview and send steps over
  useEffect(() => {
    if (!hasObjects) resetMilestones();
  }, [hasObjects]);

  // close the tip on Esc or a click outside the strip
  useEffect(() => {
    if (!tipId) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setStepperTip(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setStepperTip(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [tipId]);

  const run = (kind: string) => {
    switch (kind) {
      case "open-digitize":
        actions.setTool("select");
        actions.setSelection([]); // nothing selected shows the Auto digitize panel
        break;
      case "open-hoop":
        setHoopView({ pickerOpen: true });
        break;
      case "open-sewing":
        setSewingOpen(true);
        break;
      case "focus-player":
        document.querySelector<HTMLElement>('[data-tour="player-play"]')?.focus();
        break;
      case "open-send":
        if (hasObjects) actions.setDialog("send");
        break;
    }
    setStepperTip(null);
  };

  const step = tipId ? WORKFLOW.find((s) => s.id === tipId) : undefined;

  return (
    <nav className="stepper" aria-label="Workflow" data-tour="stepper" ref={root}>
      <ol>
        {WORKFLOW.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`step${ticks[s.id] ? " done" : ""}${now === s.id ? " now" : ""}`}
              data-step={s.id}
              data-done={ticks[s.id]}
              aria-current={now === s.id ? "step" : undefined}
              aria-expanded={tipId === s.id}
              aria-label={`${s.label}: ${ticks[s.id] ? "done" : "not done yet"}`}
              onClick={() => setStepperTip(tipId === s.id ? null : s.id)}
            >
              <span className="step-num" aria-hidden="true">
                {ticks[s.id] ? "✓" : i + 1}
              </span>
              <span className="step-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      {step && <TipCard step={step} done={ticks[step.id]} onAction={() => run(step.tip.action.kind)} />}
    </nav>
  );
}

function TipCard({ step, done, onAction }: { step: WorkflowStep; done: boolean; onAction: () => void }) {
  const { tip } = step;
  return (
    <div className="step-tip" role="region" aria-label={`${step.label}: tip`}>
      <strong>{tip.title}</strong>
      <p>{tip.body}</p>
      <p className="muted small">{done ? "This step is done." : "This step is not done yet."}</p>
      <div className="button-row">
        {tip.action.kind !== "none" && (
          <button type="button" className="primary" onClick={onAction}>
            {tip.action.label}
          </button>
        )}
        <button type="button" onClick={() => (setStepperTip(null), openHelp(tip.guideId))}>
          Read the guide
        </button>
        <button type="button" className="link-button" onClick={() => setStepperTip(null)}>
          Close
        </button>
      </div>
    </div>
  );
}
