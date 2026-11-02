"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Character, StepId, StepStatus, ViewId } from "../lib/character";
import { formatElapsed, preparePhoto } from "../lib/browser";
import { MAX_DESCRIPTION, MAX_NAME, MAX_NOTES, STYLE_IDS, STYLES, type StyleId } from "../lib/forge";
import { SplatViewer, type SplatViewerHandle } from "./splat-viewer";
import { MeshViewer } from "./mesh-viewer";
import { Refinement } from "./refinement";

type Status = { configured: boolean; mock: boolean; trellis?: boolean; refinement?: boolean; error?: string | null };

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "three_quarter", label: "Three-quarter" },
  { id: "side", label: "Side" },
  { id: "back", label: "Back" },
];

const STEPS: { id: StepId; label: string; detail: string }[] = [
  { id: "portrait", label: "Portrait", detail: "Qwen Image 2512 draws your description" },
  { id: "canonical", label: "Canonical body", detail: "Qwen Image Edit 2511 draws two full-body candidates" },
  { id: "sheet", label: "Character sheet", detail: "The multiple-angles LoRA turns the camera around" },
  { id: "splat", label: "Gaussian splat", detail: "TripoSplat rebuilds the character in 3D" },
  { id: "back", label: "Back of the body", detail: "TripoSplat rebuilds the sheet's back view, for the back half" },
  { id: "headshot", label: "Face close-up", detail: "Qwen Image Edit 2511 draws the head at full size, with the face from your portrait" },
  { id: "head", label: "Face splat", detail: "TripoSplat rebuilds the head, with the face filling the frame" },
  { id: "mesh", label: "Textured mesh", detail: "TRELLIS.2 builds geometry and PBR materials from the approved design" },
];

const fileUrl = (character: Character, name: string, download = false) =>
  `/api/characters/${character.id}/files/${name}${download ? "?download=1" : ""}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "The server could not do that.");
  return body as T;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function Forge() {
  const [status, setStatus] = useState<Status | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [current, setCurrent] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(() => {
    api<Character[]>("/api/characters").then(setCharacters).catch(() => undefined);
  }, []);

  useEffect(() => {
    api<Status>("/api/status").then(setStatus).catch(() => setStatus({ configured: false, mock: false }));
    refreshList();
    const id = new URLSearchParams(window.location.search).get("c");
    if (id) api<Character>(`/api/characters/${id}`).then(setCurrent).catch(() => undefined);
  }, [refreshList]);

  const open = useCallback((character: Character | null) => {
    setCurrent(character);
    setError(null);
    const url = new URL(window.location.href);
    if (character) url.searchParams.set("c", character.id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
    if (!character) refreshList();
  }, [refreshList]);

  // Poll while the server works on the character.
  const working = current && ((current.stage !== "done" && current.stage !== "failed" && current.stage !== "review") || current.refinement?.state === "running");
  useEffect(() => {
    if (!current || !working) return;
    const timer = setInterval(() => {
      api<Character>(`/api/characters/${current.id}`).then(setCurrent).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [current?.id, working]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (body: Record<string, unknown>) => {
    if (!current) return;
    setError(null);
    try {
      setCurrent(await api<Character>(`/api/characters/${current.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [current]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => open(null)}>
          <span className="brand-mark" aria-hidden>◆</span>
          <span>Character Forge <b>3D</b></span>
        </button>
        <span className="topbar-tag">Open weights · ComfyUI · Qwen Image · TripoSplat</span>
        {status?.mock ? <span className="pill">Mock mode</span> : null}
      </header>

      {error ? <div className="banner" role="alert">{error}</div> : null}

      {!current ? (
        <Create status={status} characters={characters} onCreated={open} onOpen={open} />
      ) : current.stage === "done" ? (
        <Reveal key={current.id} character={current} refinementReady={Boolean(status?.refinement)} onNew={() => open(null)} onChange={setCurrent} onRebuild={status?.trellis ? () => act({ mesh: true }) : undefined} onAddHead={status?.mock || status?.trellis ? () => act({ head: true }) : undefined} onAddBack={status?.mock || status?.trellis ? () => act({ back: true }) : undefined} />
      ) : current.stage === "review" ? (
        <Review character={current} onApprove={(index) => act({ approve: index })} onRecast={(notes) => act({ recast: true, notes })} />
      ) : (
        <Progress character={current} onResume={() => act({})} onRecast={() => act({ recast: true })} onNew={() => open(null)} />
      )}

      <footer className="footer">
        Character Forge 3D runs open-weights models in ComfyUI workflows. One-image 3D is a best guess of the unseen sides.
      </footer>
    </div>
  );
}

function Create({ status, characters, onCreated, onOpen }: {
  status: Status | null;
  characters: Character[];
  onCreated: (character: Character) => void;
  onOpen: (character: Character) => void;
}) {
  const [mode, setMode] = useState<"photo" | "describe">("photo");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState<StyleId>("animated");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const prepared = await preparePhoto(file);
      setPhoto(prepared);
      setPreview(URL.createObjectURL(prepared));
      if (!name) setName(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, MAX_NAME));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === "photo" && !photo) return setError("Add a picture of your character.");
    if (mode === "describe" && !description.trim()) return setError("Describe your character.");
    const form = new FormData();
    form.set("name", name);
    form.set("style", style);
    if (mode === "photo" && photo) form.set("photo", photo);
    else form.set("description", description);
    setBusy(true);
    try {
      onCreated(await api<Character>("/api/characters", { method: "POST", body: form }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const ready = status?.configured !== false;

  return (
    <main className="create">
      <section className="hero-copy">
        <p className="eyebrow">One image in. A real 3D character out.</p>
        <h1>Forge a character you can <em>walk around</em>.</h1>
        <p className="lede">
          Add a portrait. Character Forge draws a full-body design, a four-view character sheet and a textured 3D model
          that you rotate, zoom and download. Every model is open weights.
        </p>
        <ol className="pipeline">
          <li><b>01</b> Portrait</li>
          <li><b>02</b> Full body</li>
          <li><b>03</b> Sheet</li>
          <li><b>04</b> 3D model</li>
        </ol>
      </section>

      <form className="panel forge-form" onSubmit={submit}>
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "photo"} onClick={() => setMode("photo")}>Upload a picture</button>
          <button type="button" role="tab" aria-selected={mode === "describe"} onClick={() => setMode("describe")}>Describe instead</button>
        </div>

        {mode === "photo" ? (
          <div
            className={`drop${dragging ? " is-dragging" : ""}${preview ? " has-image" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void choose(event.dataTransfer.files[0]); }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") input.current?.click(); }}
          >
            {preview ? <img src={preview} alt="Your character" /> : (
              <div className="drop-empty">
                <span className="drop-icon" aria-hidden>＋</span>
                <b>Drop a character portrait</b>
                <span>PNG, JPEG or WebP. A clear face and costume work best.</span>
              </div>
            )}
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void choose(event.target.files?.[0])} />
          </div>
        ) : (
          <label className="field">
            <span>Who is your character?</span>
            <textarea
              value={description}
              maxLength={MAX_DESCRIPTION}
              rows={5}
              placeholder="A young sky pirate with a bright orange bob, brass goggles and a long striped scarf"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span>Name</span>
          <input value={name} maxLength={MAX_NAME} placeholder="Nova" onChange={(event) => setName(event.target.value)} required />
        </label>

        <fieldset className="styles">
          <legend>Style</legend>
          {STYLE_IDS.map((id) => (
            <label key={id} className={`style${style === id ? " is-active" : ""}`}>
              <input type="radio" name="style" value={id} checked={style === id} onChange={() => setStyle(id)} />
              <b>{STYLES[id].label}</b>
              <span>{STYLES[id].hint}</span>
            </label>
          ))}
        </fieldset>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!ready ? <p className="form-error">{status?.error ?? "Configure Comfy Cloud, or use FORGE_MOCK=1 for legacy samples."}</p> : null}

        <button className="primary" type="submit" disabled={busy || !ready}>
          {busy ? "Starting…" : "Forge character"}
        </button>
        <p className="fine">Approve a full-body design, then generate the sheet and textured mesh. The first 3D run may take longer while models load.</p>
      </form>

      {characters.length ? (
        <section className="roster">
          <h2>Your roster</h2>
          <div className="roster-grid">
            {characters.map((character) => {
              const image = character.splat.poster ?? character.canonical ?? character.candidates[0] ?? character.portrait;
              return (
                <button key={character.id} type="button" className="roster-card" onClick={() => onOpen(character)}>
                  {image ? <img src={fileUrl(character, image)} alt="" /> : <span className="roster-empty" />}
                  <span className="roster-name">{character.request.name}</span>
                  <span className={`roster-stage stage-${character.stage}`}>{character.stage === "done" ? "3D ready" : character.stage}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Steps({ character }: { character: Character }) {
  const now = useNow(true);
  return (
    <ol className="steps">
      {STEPS.filter((step) => character.steps[step.id] && character.steps[step.id] !== "skipped").map((step) => {
        const state: StepStatus = character.steps[step.id] ?? "waiting";
        const entry = character.timeline.find((item) => item.step === step.id);
        const elapsed = entry ? (entry.end ?? now) - entry.start : 0;
        return (
          <li key={step.id} className={`step is-${state}`}>
            <span className="step-dot" aria-hidden />
            <span className="step-text">
              <b>{step.label}</b>
              <span>{step.detail}</span>
            </span>
            <span className="step-time">{state === "waiting" ? "" : formatElapsed(elapsed)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ character, onResume, onRecast, onNew }: { character: Character; onResume: () => void; onRecast: () => void; onNew: () => void }) {
  const failed = character.stage === "failed";
  const image = character.canonical ?? character.portrait;
  const headline = failed ? "The forge stopped"
    : character.stage === "portrait" ? "Drawing the portrait"
    : character.stage === "casting" ? "Designing the full body"
    : character.steps.mesh === "running" || character.steps.mesh === "waiting" ? "Building the textured mesh"
    : character.head && character.steps.splat === "done" && character.steps.sheet === "done" ? "Sharpening the face"
    : "Building the sheet and the 3D splat";
  return (
    <main className="progress">
      <div className={`scan${character.stage === "forging" ? " is-forging" : ""}`}>
        {image ? <img src={fileUrl(character, image)} alt={character.request.name} /> : <div className="scan-empty">{character.request.description}</div>}
        {!failed ? <span className="scan-line" aria-hidden /> : null}
      </div>
      <section className="panel progress-panel">
        <p className="eyebrow">{character.request.name} · {STYLES[character.request.style].label}</p>
        <h1>{headline}</h1>
        <Steps character={character} />
        {failed ? (
          <div className="actions">
            <p className="form-error">{character.error}</p>
            <button className="primary" type="button" onClick={onResume}>Resume</button>
            {!character.canonical ? <button className="ghost" type="button" onClick={onRecast}>Draw new candidates</button> : null}
            <button className="ghost" type="button" onClick={onNew}>New character</button>
          </div>
        ) : (
          <p className="fine">You can leave this page. The server keeps forging, and the roster keeps the result.</p>
        )}
      </section>
    </main>
  );
}

function Review({ character, onApprove, onRecast }: { character: Character; onApprove: (index: number) => void; onRecast: (notes: string) => void }) {
  const [picked, setPicked] = useState(0);
  const [sent, setSent] = useState(false);
  const [notes, setNotes] = useState(character.notes ?? "");
  return (
    <main className="review">
      <header className="review-head">
        <p className="eyebrow">{character.request.name} · choose a design</p>
        <h1>Which one is {character.request.name}?</h1>
        <p className="lede">Qwen Image Edit drew two full-body designs from your picture. A body from a portrait invents what the picture does not show, so pick the one that feels right. The approved design becomes the front view and the start of the 3D model. If neither is right, say what to change and draw two more.</p>
      </header>
      <div className="candidates">
        {character.portrait ? (
          <figure className="candidate is-source">
            <img src={fileUrl(character, character.portrait)} alt="Your picture" />
            <figcaption>Your picture</figcaption>
          </figure>
        ) : null}
        {character.candidates.map((candidate, index) => (
          <button key={candidate} type="button" className={`candidate${picked === index ? " is-picked" : ""}`} onClick={() => setPicked(index)} aria-pressed={picked === index}>
            <img src={fileUrl(character, candidate)} alt={`Candidate ${index + 1}`} />
            <span className="candidate-label">Design {index + 1}</span>
          </button>
        ))}
      </div>
      <div className="actions review-actions">
        <button className="primary" type="button" disabled={sent} onClick={() => { setSent(true); onApprove(picked); }}>
          {sent ? "Forging…" : `Forge design ${picked + 1} in 3D`}
        </button>
        <div className="redraw">
          <label className="field">
            <span>What to change in the next two (optional)</span>
            <textarea rows={2} maxLength={MAX_NOTES} value={notes} disabled={sent} onChange={(event) => setNotes(event.target.value)}
              placeholder="For example: keep the long pointed ears and the tail. The cap and the overalls are only a costume." />
          </label>
          <button className="ghost" type="button" disabled={sent} onClick={() => { setSent(true); onRecast(notes); }}>Draw two more</button>
        </div>
      </div>
    </main>
  );
}

type Tab = "3d" | "sheet" | "files";
type Phase = "sheet" | "turn" | "viewer";

function Reveal({ character, onNew, onRebuild, onAddHead, onAddBack, onChange, refinementReady }: { character: Character; onNew: () => void; onRebuild?: () => void; onAddHead?: () => void; onAddBack?: () => void; onChange(character: Character): void; refinementReady: boolean }) {
  const [phase, setPhase] = useState<Phase>("sheet");
  const [tab, setTab] = useState<Tab>("3d");
  const [autoRotate, setAutoRotate] = useState(false);
  // The splat is the main view. The TRELLIS.2 mesh is optional and shows on request.
  const [showMesh, setShowMesh] = useState(false);
  const [part, setPart] = useState<"body" | "face">("body");
  const [original, setOriginal] = useState(false);
  const [showPrevious, setShowPrevious] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [refining, setRefining] = useState(false);
  const [ready, setReady] = useState(false);
  const viewer = useRef<SplatViewerHandle>(null);
  const played = useRef(false);
  const views = VIEWS.filter((view) => character.views[view.id]);
  const [loaded, setLoaded] = useState(0);
  const [waited, setWaited] = useState(false);

  // The reveal is a UI animation: the flat sheet first, then the sheet clears for the live splat.
  // Its clock starts when the sheet images are in, or after 3 seconds if they are slow.
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  const sheetShown = waited || loaded >= views.length;
  useEffect(() => {
    if (!sheetShown) return;
    const turn = setTimeout(() => setPhase((current) => current === "sheet" ? "turn" : current), 2400);
    const view = setTimeout(() => setPhase("viewer"), 3500);
    return () => { clearTimeout(turn); clearTimeout(view); };
  }, [sheetShown]);

  useEffect(() => {
    if (phase === "viewer" && ready && !played.current) {
      played.current = true;
      viewer.current?.hero();
    }
  }, [phase, ready]);

  const skip = () => setPhase("viewer");
  // The full body is the grafted splat when there is one: the body with the face-pass head.
  // The full result is the two-sided body with the face grafted on. "original" shows the splat of
  // the front image alone, for a before and after.
  const grafted = Boolean(character.graft?.sog) && !original;
  const twoSided = Boolean(character.twoSided?.sog) && !original;
  const improved = Boolean(character.graft?.sog || character.twoSided?.sog);
  const bodyFile = (grafted ? character.graft?.sog : null) ?? (twoSided ? character.twoSided?.sog : null) ?? character.splat.sog ?? character.splat.spz;
  // A graft that refused the head means the face pass drew someone else, so the viewer hides it.
  const faceFile = character.graft === null ? null : character.head?.sog ?? null;
  const fullPly = character.graft?.ply ?? character.twoSided?.ply ?? character.splat.ply;
  const fullSog = character.graft?.sog ?? character.twoSided?.sog ?? character.splat.sog;
  const fullHtml = character.graft?.html ?? character.twoSided?.html ?? character.splat.html;
  const showingFace = part === "face" && Boolean(faceFile);
  const splatFile = showingFace ? faceFile : bodyFile;
  const activeMesh = showPrevious ? character.mesh?.previous : character.mesh;
  const meshFile = activeMesh?.glb;
  const showingMesh = Boolean(meshFile && (showMesh || showPrevious || !bodyFile));
  // A new view plays the hero move again once it has loaded.
  const switchView = (change: () => void) => { setReady(false); played.current = false; change(); };

  const files = useMemo(() => [
    { name: character.graft?.sog, label: "Full body with sharp face · SOG", note: "The body splat with the face-pass head grafted on" },
    { name: character.graft?.ply, label: "Full body with sharp face · PLY", note: "The grafted splat as a standard 3D Gaussian splat" },
    { name: character.twoSided?.sog, label: "Front and back body · SOG", note: "The front splat joined with a splat of the sheet's back view" },
    { name: character.twoSided?.ply, label: "Front and back body · PLY", note: "The joined splat as a standard 3D Gaussian splat" },
    { name: character.back?.ply, label: "Back splat · PLY", note: "TripoSplat of the sheet's back view, before the join" },
    { name: character.head?.sog, label: "Face splat · SOG", note: "The head rebuilt at full resolution, for close-ups" },
    { name: character.head?.ply, label: "Face splat · PLY", note: "The face splat as a standard 3D Gaussian splat" },
    { name: character.head?.image, label: "Face close-up image", note: "The front-facing head the face splat starts from" },
    { name: character.mesh?.glb, label: character.mesh?.model === "ModelSheetTo3D" ? "Refined model · GLB" : "Textured mesh · GLB", note: character.mesh?.model === "ModelSheetTo3D" ? "Flat-colored geometry with a separate face decal point layer" : character.mesh?.input === "multiview" ? "TRELLIS.2 with experimental sheet conditioning" : "TRELLIS.2 from the approved front image" },
    { name: character.refinement?.ply, label: "Refined geometry · PLY", note: "The upstream flat-colored mesh" },
    { name: character.refinement?.decal, label: "Face decal points · PLY", note: "Face details kept as a separate point cloud" },
    { name: character.refinement?.preview, label: "ModelSheetTo3D preview", note: "The paper’s stylized front-view render; appearance differs from standard GLB" },
    { name: character.mesh?.previous?.glb, label: "Previous mesh · GLB", note: "The preserved result before rebuilding" },
    { name: character.splat.sog, label: "Splat · SOG", note: "Compressed web splat for PlayCanvas and Spark" },
    { name: character.splat.spz, label: "Splat · SPZ", note: "TripoSplat's own export, Niantic SPZ" },
    { name: character.splat.ply, label: "Splat · PLY", note: "Standard 3D Gaussian splat for any tool" },
    { name: fullHtml, label: "Standalone viewer", note: "One HTML file with the splat inside" },
    { name: character.sheet, label: "Character sheet", note: "Front, three-quarter, side and back" },
    { name: character.splat.orbit, label: "Orbit video", note: "A 360° turntable rendered in ComfyUI" },
    { name: character.canonical, label: "Canonical image", note: "The approved full-body design" },
  ].filter((file): file is { name: string; label: string; note: string } => Boolean(file.name)), [character]);

  return (
    <main className={`reveal phase-${phase}${sheetShown ? " sheet-shown" : ""}`} onClick={phase !== "viewer" ? skip : undefined}>
      <div className="reveal-sheet" aria-hidden={phase === "viewer"}>
        <p className="eyebrow">Character sheet</p>
        <div className="reveal-views">
          {views.map((view, index) => (
            <figure key={view.id} style={{ ["--i" as string]: index }}>
              <img src={fileUrl(character, character.views[view.id]!)} alt={view.label} onLoad={() => setLoaded((count) => count + 1)} onError={() => setLoaded((count) => count + 1)} />
              <figcaption>{view.label}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className="reveal-stage">
        <div className="stage-floor" aria-hidden />
        {showingMesh && meshFile && tab === "3d" ? (
          <MeshViewer ref={viewer} url={fileUrl(character, meshFile)} autoRotate={autoRotate} wireframe={wireframe} part={activeMesh?.part} onReady={() => setReady(true)} />
        ) : splatFile && tab === "3d" ? (
          <SplatViewer key={splatFile} ref={viewer} url={fileUrl(character, splatFile)} autoRotate={autoRotate} onReady={() => setReady(true)} />
        ) : null}
        {tab === "sheet" && (character.sheet || character.canonical) ? (
          <div className="sheet-view"><img src={fileUrl(character, (character.sheet || character.canonical)!)} alt={`${character.request.name} ${character.sheet ? "character sheet" : "source image"}`} /></div>
        ) : null}
        {tab === "files" ? (
          <div className="files">
            {files.map((file) => (
              <a key={file.name} className="file" href={fileUrl(character, file.name, true)} download>
                <b>{file.label}</b>
                <span>{file.note}</span>
                <span className="file-get">Download</span>
              </a>
            ))}
            {fullHtml ? (
              <a className="file is-open" href={fileUrl(character, fullHtml)} target="_blank" rel="noreferrer">
                <b>Open the standalone viewer</b>
                <span>SuperSplat viewer, made by SplatTransform</span>
                <span className="file-get">Open</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="hud">
        <div className="hud-title">
          <p className="eyebrow">Character Forge 3D · your character is ready</p>
          <h1>{character.request.name}</h1>
          <p className="hud-sub">{STYLES[character.request.style].label} · {showingMesh ? `${activeMesh?.model ?? "TRELLIS.2"} · ${activeMesh?.model === "ModelSheetTo3D" ? "Refined mesh + decal points · experimental" : activeMesh?.input === "multiview" ? "Multiview · experimental" : "Single image"}${showPrevious ? " · previous mesh" : ""}` : showingFace ? "Face close-up · TripoSplat at full resolution" : ["Gaussian splat by TripoSplat", twoSided ? "back from the sheet" : null, grafted ? "sharp face grafted on" : null, original ? "front image only" : null].filter(Boolean).join(" · ")}</p>
        </div>
        <nav className="tabs" role="tablist">
          {(["3d", "sheet", "files"] as Tab[]).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {id === "3d" ? "3D character" : id === "sheet" ? (character.sheet ? "Character sheet" : "Source image") : "Files"}
            </button>
          ))}
        </nav>
        <div className="hud-bar">
          {tab === "3d" ? (
            <div className="hud-controls">
              <span className="hint">Drag to rotate · scroll to zoom</span>
              {faceFile && bodyFile && !showingMesh ? (
                <span className="segmented part-switch" role="tablist" aria-label="Part">
                  <button type="button" role="tab" aria-selected={!showingFace} onClick={() => switchView(() => setPart("body"))}>Full body</button>
                  <button type="button" role="tab" aria-selected={showingFace} onClick={() => switchView(() => setPart("face"))}>Face</button>
                </span>
              ) : null}
              {improved && !showingFace && !showingMesh ? (
                <button type="button" className={`chip${original ? " is-on" : ""}`} aria-pressed={original} onClick={() => switchView(() => setOriginal((on) => !on))}>{original ? "Show the full result" : "Compare front image only"}</button>
              ) : null}
              {!character.back?.spz && onAddBack && character.views.back && bodyFile && !showingMesh ? (
                <button type="button" className="chip" disabled={character.steps.back === "running"} onClick={onAddBack}>Add back from sheet</button>
              ) : null}
              {!character.head?.sog && onAddHead && bodyFile ? (
                <button type="button" className="chip" disabled={character.steps.head === "running" || character.steps.headshot === "running"} onClick={onAddHead}>Add face close-up</button>
              ) : null}
              {onRebuild ? <button type="button" className="chip" onClick={onRebuild}>{character.mesh?.glb ? "Rebuild TRELLIS.2 mesh" : "Build TRELLIS.2 mesh"}</button> : null}
              {character.mesh?.glb && character.mesh.model !== "ModelSheetTo3D" && VIEWS.every((view) => character.views[view.id]) ? <button type="button" className="chip" onClick={() => setRefining(true)}>{character.refinement?.state === "running" ? "Refining with ModelSheetTo3D…" : character.refinement?.state === "failed" ? "Refinement needs attention" : "Refine with ModelSheetTo3D"}</button> : null}
              {character.mesh?.glb && bodyFile ? <button type="button" className={`chip${showingMesh ? " is-on" : ""}`} aria-pressed={showingMesh} onClick={() => switchView(() => { setShowPrevious(false); setShowMesh(!showingMesh); })}>{showingMesh ? "Show splat" : "Show TRELLIS.2 mesh"}</button> : null}
              {character.mesh?.previous?.glb ? <button type="button" className={`chip${showPrevious ? " is-on" : ""}`} aria-pressed={showPrevious} onClick={() => switchView(() => setShowPrevious((on) => !on))}>{showPrevious ? "Show new mesh" : "Compare previous mesh"}</button> : null}
              {showingMesh ? <button type="button" className="chip" onClick={() => { setAutoRotate(false); viewer.current?.face?.(); }}>Face close-up</button> : null}
              {showingMesh ? <button type="button" className={`chip${wireframe ? " is-on" : ""}`} aria-pressed={wireframe} onClick={() => setWireframe((on) => !on)}>Wireframe</button> : null}
              <button type="button" className="chip" onClick={() => viewer.current?.reset()}>Reset view</button>
              <button type="button" className={`chip${autoRotate ? " is-on" : ""}`} aria-pressed={autoRotate} onClick={() => setAutoRotate((on) => !on)}>Auto-orbit</button>
            </div>
          ) : null}
          <div className="hud-exports">
            {meshFile ? <a className="chip" href={fileUrl(character, meshFile, true)} download>Download .glb</a> : null}
            {fullSog ? <a className="chip" href={fileUrl(character, fullSog, true)} download>Download .sog</a> : null}
            {fullPly ? <a className="chip" href={fileUrl(character, fullPly, true)} download>.ply</a> : null}
            {character.sheet ? <a className="chip" href={fileUrl(character, character.sheet, true)} download>Sheet</a> : null}
            <button type="button" className="chip" onClick={onNew}>New character</button>
          </div>
        </div>
      </div>
      {phase !== "viewer" ? <button type="button" className="skip" onClick={skip}>Skip</button> : null}
      {refining ? <Refinement character={character} ready={refinementReady} onClose={() => setRefining(false)} onChange={(updated) => { setShowPrevious(false); setShowMesh(true); onChange(updated); }} /> : null}
    </main>
  );
}
