"use client";

import { useEffect, useRef, useState } from "react";
import type { Character } from "../lib/character";
import type { RefinementSettings } from "../lib/modelsheet";

const VIEWS = [{ id: "front", label: "Front" }, { id: "three_quarter", label: "Three-quarter" }, { id: "side", label: "Side" }, { id: "back", label: "Back" }] as const;

export function Refinement({ character, onClose, onChange, ready }: { character: Character; onClose(): void; onChange(character: Character): void; ready: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<RefinementSettings>(() => character.refinement?.manifest.settings ?? { angles: { front: 0, three_quarter: 45, side: 90, back: 180 }, meshYaw: 0, face: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(character.refinement?.state === "prepared");
  const running = character.refinement?.state === "running";
  const locked = Boolean(busy) || running;
  const source = `/api/characters/${character.id}/files/`;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (character.refinement?.state === "imported") onClose(); }, [character.refinement?.state, onClose]);

  const start = async (resume = false) => {
    setBusy(resume ? "Reconnecting to refinement…" : "Submitting refinement…"); setError(null);
    try {
      const response = await fetch(`/api/characters/${character.id}/refinement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(resume ? { resume: true } : { ...settings, run: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onChange(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };

  const prepare = async () => {
    setBusy("Preparing the mesh and four views…"); setError(null);
    try {
      const response = await fetch(`/api/characters/${character.id}/refinement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a"); a.href = url; a.download = `modelsheet-${character.id}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPrepared(true);
      const updated = await fetch(`/api/characters/${character.id}`);
      if (updated.ok) onChange(await updated.json());
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };

  const importResult = async (file: File) => {
    setBusy("Checking and importing the refined model…"); setError(null);
    try {
      if (file.size > 250 * 1024 * 1024) throw new Error("Result ZIP must be under 250 MB.");
      const response = await fetch(`/api/characters/${character.id}/refinement`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onChange(result); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };

  return <dialog className="refinement-dialog" ref={dialog} aria-labelledby="refinement-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="refinement-header"><div><p className="eyebrow">Experimental refinement</p><h2 id="refinement-title">Refine with ModelSheetTo3D</h2></div><button className="chip" type="button" disabled={Boolean(busy)} onClick={onClose}>Close</button></div>
    <p>Fit the TRELLIS.2 mesh to your sheet and transfer its flat colors and face details. Best suited to flat-colored drawings; shaded sheets may lose texture detail. Likeness improvements are not guaranteed.</p>
    <div className="refinement-grid">
      <section>
        <h3>1. Outline the face details</h3>
        <p id="mask-help">Click around the eyes, nose and mouth to draw a polygon. Include the details you want to preserve; avoid hair and background.</p>
        <div className="refinement-mask">
          <img src={`${source}${character.views.front}`} alt="Front view for face detail annotation" draggable={false} />
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Face detail mask" aria-describedby="mask-help" onPointerDown={(event) => {
            if (locked || settings.face.length >= 100) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const point: [number, number] = [Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))];
            setSettings((s) => ({ ...s, face: [...s.face, point] }));
          }}>
            {settings.face.length > 1 ? <polygon points={settings.face.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} fill="rgba(94,231,255,.25)" stroke="#5ee7ff" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
            {settings.face.map(([x, y], i) => <circle key={i} cx={x * 1000} cy={y * 1000} r="5" fill="#5ee7ff" />)}
          </svg>
        </div>
        <div className="refinement-actions"><button className="chip" disabled={locked || !settings.face.length} onClick={() => setSettings((s) => ({ ...s, face: s.face.slice(0, -1) }))}>Undo point</button><button className="chip" disabled={locked || !settings.face.length} onClick={() => setSettings((s) => ({ ...s, face: [] }))}>Clear mask</button><span>{settings.face.length} points</span></div>
      </section>
      <section>
        <h3>2. Check the view angles</h3>
        <p>Yaw is the camera position: 0° front, 90° camera on the character’s left, 180° back. Use 270° for the opposite side. Check that the images match.</p>
        <div className="refinement-angles">{VIEWS.map(({ id, label }) => <label className="field" key={id}><img src={`${source}${character.views[id]}`} alt={label} /><span>{label} yaw (°)</span><input type="number" min={0} max={360} step={1} disabled={locked || id === "front"} value={settings.angles[id]} onChange={(e) => setSettings((s) => ({ ...s, angles: { ...s.angles, [id]: Number(e.target.value) } }))} /></label>)}</div>
        <label className="field">Base mesh rotation about Y (°)<input type="number" min={-360} max={360} disabled={locked} value={settings.meshYaw} onChange={(e) => setSettings((s) => ({ ...s, meshYaw: Number(e.target.value) }))} /></label>
        <h3>3. Refine the model</h3>
        <p>The app sends the mesh, views and face mask to the GPU, then loads the refined model here automatically. Your original TRELLIS.2 mesh stays available for comparison.</p>
        <button className="primary" type="button" disabled={locked || !ready || settings.face.length < 3} onClick={() => start()}>{running ? "Refinement running…" : "Start refinement"}</button>
        {running ? <p role="status">Refining geometry, colors and face details. You can close this dialog; the job continues.</p> : !ready ? <p role="status">The refinement GPU deployment is not ready yet.</p> : null}
        {character.refinement?.state === "failed" ? <div><p className="form-error" role="alert">{character.refinement.error}</p><button className="chip" disabled={Boolean(busy)} onClick={() => start(true)}>Resume refinement</button></div> : null}
        <p>The result includes refined geometry and a face decal point layer. The paper’s view-dependent rendering is supplied as a separate preview.</p>
        <details className="refinement-advanced"><summary>Advanced: export or import a refinement job</summary>
          <p>Use an external runner for diagnostics or another GPU host.</p>
          <button className="chip" type="button" disabled={locked || settings.face.length < 3} onClick={prepare}>{prepared ? "Download a new input bundle" : "Download input bundle"}</button>
          <p className="refinement-note">Each new bundle replaces the pending preparation. Import the matching result ZIP.</p>
          <label className="field">Result ZIP<input type="file" accept=".zip,application/zip" disabled={locked || !prepared} onChange={(e) => { const file = e.target.files?.[0]; if (file) void importResult(file); e.target.value = ""; }} /></label>
        </details>
      </section>
    </div>
    {busy ? <p role="status">{busy}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </dialog>;
}
