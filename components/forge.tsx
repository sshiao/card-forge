"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Card as CardRecord, StepId, StepStatus } from "../lib/card";
import { formatElapsed, preparePhoto } from "../lib/browser";
import {
  ART_STYLE_IDS, ART_STYLES, DEFAULT_ART_STYLE, DEFAULT_FRAME, DEFAULT_OUTFIT, ELEMENT_IDS, ELEMENTS, FRAME_IDS, FRAMES, MAX_NAME, MAX_NOTES,
  OUTFIT_IDS, OUTFITS, SET_SIZE, type ArtStyleId, type CardText, type ElementId, type FrameId, type OutfitId,
} from "../lib/forge";
import { Badge, Card } from "./card";
import type { GlassHandle } from "./glass";

// Three.js loads only in the browser, and only when a glass card is on screen.
const GlassCard = dynamic(() => import("./glass").then((module) => module.GlassCard), { ssr: false });
const LAYOUT_NAMES = { framed: "framed", full: "full-art", cutout: "glass" } as const;

type Status = { configured: boolean; mock: boolean; error?: string | null };

const STEPS: { id: StepId; label: string; detail: string }[] = [
  { id: "text", label: "Writing the card", detail: "Qwen3-VL-8B looks at your photo and writes the name, element, HP and moves" },
  { id: "art", label: "Painting the art", detail: "Qwen Image Edit 2511 paints you as the hero, twice" },
];

const fileUrl = (card: CardRecord, name: string, download = false) => `/api/cards/${card.id}/files/${name}${download ? "?download=1" : ""}`;

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

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));
const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";

export function Forge() {
  const [status, setStatus] = useState<Status | null>(null);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [current, setCurrent] = useState<CardRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(() => {
    api<CardRecord[]>("/api/cards").then(setCards).catch(() => undefined);
  }, []);

  useEffect(() => {
    api<Status>("/api/status").then(setStatus).catch(() => setStatus({ configured: false, mock: false }));
    refreshList();
    const id = new URLSearchParams(window.location.search).get("c");
    if (id) api<CardRecord>(`/api/cards/${id}`).then(setCurrent).catch(() => undefined);
  }, [refreshList]);

  const open = useCallback((card: CardRecord | null) => {
    setCurrent(card);
    setError(null);
    const url = new URL(window.location.href);
    if (card) url.searchParams.set("c", card.id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
    if (!card) refreshList();
  }, [refreshList]);

  // Poll while the server works on the card.
  const working = current && (current.stage === "writing" || current.stage === "drawing");
  useEffect(() => {
    if (!current || !working) return;
    const timer = setInterval(() => {
      api<CardRecord>(`/api/cards/${current.id}`).then(setCurrent).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [current?.id, working]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (body: Record<string, unknown>) => {
    if (!current) return;
    setError(null);
    try {
      setCurrent(await api<CardRecord>(`/api/cards/${current.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
    } catch (reason) {
      setError(message(reason));
    }
  }, [current]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => open(null)}>
          <span className="brand-mark" aria-hidden>◆</span>
          <span>Card <b>Forge</b></span>
        </button>
        <span className="topbar-tag">Open weights · ComfyUI · Qwen3-VL · Qwen Image Edit</span>
        {status?.mock ? <span className="pill">Mock mode</span> : null}
      </header>

      {error ? <div className="banner" role="alert">{error}</div> : null}

      {!current ? (
        <Create status={status} cards={cards} onCreated={open} onOpen={open} />
      ) : current.stage === "done" && current.text && current.art ? (
        <CardScreen key={current.id} card={current} onAct={act} onNew={() => open(null)} />
      ) : current.stage === "review" && current.text ? (
        <Review card={current} onApprove={(index) => act({ approve: index })} onRecast={(notes, rewrite, outfit) => act({ recast: true, notes, rewrite, outfit })} />
      ) : (
        <Progress card={current} onResume={() => act({})} onNew={() => open(null)} />
      )}

      <footer className="footer">
        Card Forge runs open-weights models in ComfyUI workflows. The card designs are original and not tied to any game, brand or league.
      </footer>
    </div>
  );
}

function Create({ status, cards, onCreated, onOpen }: {
  status: Status | null;
  cards: CardRecord[];
  onCreated: (card: CardRecord) => void;
  onOpen: (card: CardRecord) => void;
}) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [element, setElement] = useState<ElementId | "auto">("auto");
  const [frame, setFrame] = useState<FrameId>(DEFAULT_FRAME);
  const [artStyle, setArtStyle] = useState<ArtStyleId>(DEFAULT_ART_STYLE);
  const [outfit, setOutfit] = useState<OutfitId>(DEFAULT_OUTFIT);
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
    } catch (reason) {
      setError(message(reason));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!photo) return setError("Add a photo first.");
    const form = new FormData();
    form.set("photo", photo);
    form.set("name", name);
    form.set("element", element);
    form.set("frame", frame);
    form.set("artStyle", artStyle);
    form.set("outfit", outfit);
    setBusy(true);
    try {
      onCreated(await api<CardRecord>("/api/cards", { method: "POST", body: form }));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const ready = status?.configured !== false;

  return (
    <main className="create">
      <section className="hero-copy">
        <p className="eyebrow">One photo in. One trading card out.</p>
        <h1>Turn yourself into a <em>holo card</em>.</h1>
        <p className="lede">
          Add a photo of yourself or a friend. Qwen3-VL reads it and writes your card: a name, an element, HP and two moves
          that fit you. Qwen Image Edit paints you as the hero. Pick one of nine frames, from vintage holo and chrome sports cards to a 3D glass card, tilt it in the light, and download it.
        </p>
        <ol className="pipeline">
          <li><b>01</b> Photo</li>
          <li><b>02</b> Card text</li>
          <li><b>03</b> Hero art</li>
          <li><b>04</b> Your card</li>
        </ol>
      </section>

      <form className="panel forge-form" onSubmit={submit}>
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
          {preview ? <img src={preview} alt="Your photo" /> : (
            <div className="drop-empty">
              <span className="drop-icon" aria-hidden>＋</span>
              <b>Drop a photo, or take one</b>
              <span>PNG, JPEG or WebP. One person, face clearly visible.</span>
            </div>
          )}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" capture="user" hidden onChange={(event) => void choose(event.target.files?.[0])} />
        </div>

        <label className="field">
          <span>Name on the card</span>
          <input value={name} maxLength={MAX_NAME} placeholder="Leave empty and Qwen names you" onChange={(event) => setName(event.target.value)} />
        </label>

        <fieldset className="choices">
          <legend>Card frame</legend>
          <div className="frames">
            {FRAME_IDS.map((id) => (
              <label key={id} className={`style frame-${id}${frame === id ? " is-active" : ""}`}>
                <input type="radio" name="frame" value={id} checked={frame === id} onChange={() => setFrame(id)} />
                <span className="frame-swatch" aria-hidden />
                <b>{FRAMES[id].label}</b>
                <span>{FRAMES[id].hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="choices">
          <legend>Element</legend>
          <div className="elements">
            <button type="button" className={`element-chip${element === "auto" ? " is-active" : ""}`} onClick={() => setElement("auto")}>Auto</button>
            {ELEMENT_IDS.map((id) => (
              <button key={id} type="button" className={`element-chip${element === id ? " is-active" : ""}`} onClick={() => setElement(id)} title={ELEMENTS[id].label}>
                <svg viewBox="0 0 28 28" width="20" height="20" aria-hidden><Badge element={id} x={14} y={14} r={13} /></svg>
                {ELEMENTS[id].label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="choices">
          <legend>Art style</legend>
          <div className="styles">
            {ART_STYLE_IDS.map((id) => (
              <label key={id} className={`style${artStyle === id ? " is-active" : ""}`}>
                <input type="radio" name="artStyle" value={id} checked={artStyle === id} onChange={() => setArtStyle(id)} />
                <b>{ART_STYLES[id].label}</b>
                <span>{ART_STYLES[id].hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="choices">
          <legend>Clothes</legend>
          <div className="styles">
            {OUTFIT_IDS.map((id) => (
              <label key={id} className={`style${outfit === id ? " is-active" : ""}`}>
                <input type="radio" name="outfit" value={id} checked={outfit === id} onChange={() => setOutfit(id)} />
                <b>{OUTFITS[id].label}</b>
                <span>{OUTFITS[id].hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!ready ? <p className="form-error">{status?.error ?? "Configure Comfy Cloud, or set FORGE_MOCK=1 to try the app with sample files."}</p> : null}

        <button className="primary" type="submit" disabled={busy || !ready}>{busy ? "Starting…" : "Forge my card"}</button>
        <p className="fine">About a minute on Comfy Cloud. Use photos you have the right to use, and ask before you make a card of someone else.</p>
      </form>

      {cards.length ? (
        <section className="roster">
          <h2>Your cards</h2>
          <div className="roster-grid">
            {cards.map((card) => (
              <button key={card.id} type="button" className="roster-card" onClick={() => onOpen(card)}>
                {card.text && card.art ? (
                  <Card text={card.text} art={fileUrl(card, card.art)} frame={card.frame} number={card.number} setSize={SET_SIZE} className="roster-svg" />
                ) : (
                  <>
                    <img src={fileUrl(card, card.photo)} alt="" />
                    <span className="roster-name">{card.text?.name ?? (card.request.name || "New card")}</span>
                    <span className={`roster-stage stage-${card.stage}`}>{card.stage === "review" ? "pick your art" : card.stage}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Steps({ card }: { card: CardRecord }) {
  const now = useNow(true);
  return (
    <ol className="steps">
      {STEPS.map((step) => {
        const state: StepStatus = card.steps[step.id] ?? "waiting";
        const entry = card.timeline.find((item) => item.step === step.id);
        const elapsed = entry ? (entry.end ?? now) - entry.start : 0;
        return (
          <li key={step.id} className={`step is-${state}`}>
            <span className="step-dot" aria-hidden />
            <span className="step-text">
              <b>{step.label}</b>
              <span>{step.id === "art" && FRAMES[card.frame].layout === "cutout" ? `${step.detail}, and BiRefNet cuts you out for the glass card` : step.detail}</span>
            </span>
            <span className="step-time">{state === "waiting" ? "" : formatElapsed(elapsed)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ card, onResume, onNew }: { card: CardRecord; onResume: () => void; onNew: () => void }) {
  const failed = card.stage === "failed";
  const headline = failed ? "The forge stopped" : card.stage === "writing" ? "Reading your photo" : "Painting you as the hero";
  return (
    <main className="progress">
      {/* Once the text is written, the card shows with the photo in place of the art. */}
      {card.text ? (
        <div className="progress-card">
          <Card text={card.text} art={fileUrl(card, card.photo)} frame={card.frame} number={card.number} setSize={SET_SIZE} className="card-svg is-pending" />
          {!failed ? <span className="paint-line" aria-hidden /> : null}
        </div>
      ) : (
        <div className="scan">
          <img src={fileUrl(card, card.photo)} alt="Your photo" />
          {!failed ? <span className="scan-line" aria-hidden /> : null}
        </div>
      )}
      <section className="panel progress-panel">
        <p className="eyebrow">{card.text?.name ?? (card.request.name || "Your card")} · {FRAMES[card.frame].label}</p>
        <h1>{headline}</h1>
        <Steps card={card} />
        {failed ? (
          <div className="actions">
            <p className="form-error">{card.error}</p>
            <button className="primary" type="button" onClick={onResume}>Resume</button>
            <button className="ghost" type="button" onClick={onNew}>New card</button>
          </div>
        ) : (
          <p className="fine">You can leave this page. The server keeps working, and your cards keep the result.</p>
        )}
      </section>
    </main>
  );
}

// Own clothes or a hero outfit, for the next art candidates.
function OutfitSwitch({ value, onChange, disabled = false }: { value: OutfitId; onChange: (value: OutfitId) => void; disabled?: boolean }) {
  return (
    <div className="outfit-switch" role="radiogroup" aria-label="Clothes">
      {OUTFIT_IDS.map((id) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} disabled={disabled}
          className={`element-chip${value === id ? " is-active" : ""}`} onClick={() => onChange(id)}>
          {OUTFITS[id].label}
        </button>
      ))}
    </div>
  );
}

function Review({ card, onApprove, onRecast }: {
  card: CardRecord;
  onApprove: (index: number) => void;
  onRecast: (notes: string, rewrite: boolean, outfit: OutfitId) => void;
}) {
  const [picked, setPicked] = useState(0);
  const [sent, setSent] = useState(false);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [rewrite, setRewrite] = useState(false);
  const [outfit, setOutfit] = useState<OutfitId>(card.outfit ?? DEFAULT_OUTFIT);
  const text = card.text!;
  return (
    <main className="review">
      <header className="review-head">
        <p className="eyebrow">{text.name} · choose your art</p>
        <h1>Which one is the real {text.name}?</h1>
        <p className="lede">Qwen Image Edit painted two versions. Pick the one that looks most like you. You can change the frame and the text on the next screen.</p>
      </header>
      <div className="candidates card-candidates">
        <figure className="candidate is-source">
          <img src={fileUrl(card, card.photo)} alt="Your photo" />
          <figcaption>Your photo</figcaption>
        </figure>
        {card.candidates.map((candidate, index) => (
          <button key={candidate} type="button" className={`candidate card-pick${picked === index ? " is-picked" : ""}`} onClick={() => setPicked(index)} aria-pressed={picked === index}>
            <Card text={text} art={fileUrl(card, candidate)} frame={card.frame} number={card.number} setSize={SET_SIZE} className="card-svg" />
            <span className="candidate-label">Art {index + 1}</span>
          </button>
        ))}
      </div>
      <div className="actions review-actions">
        <button className="primary" type="button" disabled={sent} onClick={() => { setSent(true); onApprove(picked); }}>
          {sent ? "Saving…" : `Make card with art ${picked + 1}`}
        </button>
        <div className="redraw">
          <label className="field">
            <span>What to change in the next two (optional)</span>
            <textarea rows={2} maxLength={MAX_NOTES} value={notes} disabled={sent} onChange={(event) => setNotes(event.target.value)}
              placeholder="For example: make me look braver, keep my glasses, add a cat on my shoulder." />
          </label>
          <div className="redraw-buttons">
            <OutfitSwitch value={outfit} onChange={setOutfit} disabled={sent} />
            <label className="check"><input type="checkbox" checked={rewrite} disabled={sent} onChange={(event) => setRewrite(event.target.checked)} /> New card text too</label>
            <button className="ghost" type="button" disabled={sent} onClick={() => { setSent(true); onRecast(notes, rewrite, outfit); }}>Draw two more</button>
          </div>
        </div>
      </div>
    </main>
  );
}

// The card in the light: it tilts toward the pointer, and the foil and the glare follow it.
function Holo({ frame, children }: { frame: FrameId; children: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(true);
  const move = (event: React.PointerEvent) => {
    const element = host.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    element.style.setProperty("--rx", `${(0.5 - y) * 22}deg`);
    element.style.setProperty("--ry", `${(x - 0.5) * 26}deg`);
    element.style.setProperty("--px", `${x * 100}%`);
    element.style.setProperty("--py", `${y * 100}%`);
    setIdle(false);
  };
  const leave = () => {
    const element = host.current;
    if (!element) return;
    for (const name of ["--rx", "--ry", "--px", "--py"]) element.style.removeProperty(name);
    setIdle(true);
  };
  return (
    <div ref={host} className={`holo${idle ? " is-idle" : ""}`} onPointerMove={move} onPointerLeave={leave}>
      <div className="holo-inner">
        {children}
        <span className={`foil foil-${frame}`} aria-hidden />
        <span className="glare" aria-hidden />
      </div>
    </div>
  );
}

async function dataUrl(url: string) {
  const blob = await (await fetch(url)).blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Draws the card SVG to a canvas at twice its size and saves it as a PNG. The art goes in as a
// data URL, because an SVG drawn to a canvas cannot load other files.
async function exportPng(svg: SVGSVGElement, art: string, name: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const inline = await dataUrl(art);
  clone.querySelectorAll("image").forEach((image) => image.setAttribute("href", inline));
  const width = 1260;
  const height = 1760;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("This browser could not make the PNG.");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${slug(name)}-card.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CardScreen({ card, onAct, onNew }: { card: CardRecord; onAct: (body: Record<string, unknown>) => Promise<void>; onNew: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const glassCard = useRef<GlassHandle>(null);
  const [frame, setFrame] = useState<FrameId>(card.frame);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [recording, setRecording] = useState(false);
  // Without WebGL the glass card shows flat, with the tilt of the other frames.
  const [flat, setFlat] = useState(false);
  const onFail = useCallback(() => setFlat(true), []);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [outfit, setOutfit] = useState<OutfitId>(card.outfit ?? DEFAULT_OUTFIT);
  const text = card.text!;
  const art = fileUrl(card, card.art!);
  const crops = FRAMES[frame].layout !== card.layout;
  const glass = frame === "glass" && !flat;

  const pick = (id: FrameId) => {
    setFrame(id);
    void onAct({ frame: id });
  };
  const save = async () => {
    setError(null);
    setExporting(true);
    try {
      if (glass) await glassCard.current!.png(text.name);
      else await exportPng(svg.current!, art, text.name);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setExporting(false);
    }
  };
  const record = async () => {
    setError(null);
    setRecording(true);
    try {
      await glassCard.current!.video(text.name);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setRecording(false);
    }
  };

  return (
    <main className="card-screen">
      <section className="card-stage">
        {glass ? (
          <GlassCard ref={glassCard} text={text} art={art} number={card.number} setSize={SET_SIZE} onFail={onFail} />
        ) : (
          <Holo frame={frame}>
            <Card ref={svg} text={text} art={art} frame={frame} number={card.number} setSize={SET_SIZE} className="card-svg" />
          </Holo>
        )}
        <p className="fine">{glass ? "Drag the card to turn it. Flick it and it spins." : "Move the pointer over the card to tilt it in the light."}</p>
      </section>

      <section className="panel card-panel">
        <p className="eyebrow">{ELEMENTS[text.element].label} type · No. {String(card.number).padStart(3, "0")}/{SET_SIZE}</p>
        <h1>{text.name}</h1>
        {text.title ? <p className="lede">{text.title}</p> : null}

        <h2 className="panel-heading">Frame</h2>
        <div className="frame-switch">
          {FRAME_IDS.map((id) => (
            <button key={id} type="button" className={`frame-option${frame === id ? " is-active" : ""}`} onClick={() => pick(id)} aria-pressed={frame === id}>
              <Card text={text} art={art} frame={id} number={card.number} setSize={SET_SIZE} className="frame-thumb" />
              <span>{FRAMES[id].label}</span>
            </button>
          ))}
        </div>
        {crops ? (
          <p className="fine">
            {FRAMES[frame].layout === "cutout"
              ? "The glass card shows you cut out of the background, and this art still has one."
              : card.layout === "cutout"
                ? "The art was painted for the glass card, so it has no background in this frame."
                : `The art was painted for a ${LAYOUT_NAMES[card.layout]} card, so this frame crops it.`}{" "}
            <button type="button" className="link" onClick={() => onAct({ recast: true, frame, notes, outfit })}>Paint art for this frame</button>
          </p>
        ) : null}

        <div className="actions">
          <button className="primary" type="button" disabled={exporting || recording} onClick={save}>{exporting ? "Saving…" : "Download card PNG"}</button>
          {glass ? <button className="ghost" type="button" disabled={exporting || recording} onClick={record}>{recording ? "Making the video…" : "Turntable video"}</button> : null}
          <a className="ghost" href={fileUrl(card, card.art!, true)} download>Art only</a>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <details className="edit" open={editing} onToggle={(event) => setEditing((event.target as HTMLDetailsElement).open)}>
          <summary>Edit the card text</summary>
          {editing ? <TextEditor text={text} onSave={(edited) => onAct({ text: edited })} /> : null}
        </details>

        <details className="edit">
          <summary>Paint new art</summary>
          <label className="field">
            <span>What to change (optional)</span>
            <textarea rows={2} maxLength={MAX_NOTES} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="For example: a stormy sky, a bigger smile." />
          </label>
          <div className="actions">
            <OutfitSwitch value={outfit} onChange={setOutfit} />
            <button className="ghost" type="button" onClick={() => onAct({ recast: true, notes, frame, outfit })}>Draw two more</button>
          </div>
        </details>

        <div className="actions">
          <button className="ghost" type="button" onClick={onNew}>Make another card</button>
        </div>
      </section>
    </main>
  );
}

function TextEditor({ text, onSave }: { text: CardText; onSave: (text: CardText) => Promise<void> }) {
  const [draft, setDraft] = useState<CardText>(text);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<CardText>) => setDraft((old) => ({ ...old, ...patch }));
  const setAttack = (index: number, patch: Partial<CardText["attacks"][number]>) =>
    setDraft((old) => ({ ...old, attacks: old.attacks.map((attack, i) => (i === index ? { ...attack, ...patch } : attack)) }));
  const elementSelect = (value: ElementId | null, onChange: (value: ElementId | null) => void, allowNone = false) => (
    <select value={value ?? "none"} onChange={(event) => onChange(event.target.value === "none" ? null : event.target.value as ElementId)}>
      {allowNone ? <option value="none">None</option> : null}
      {ELEMENT_IDS.map((id) => <option key={id} value={id}>{ELEMENTS[id].label}</option>)}
    </select>
  );
  return (
    <form className="editor" onSubmit={async (event) => { event.preventDefault(); setSaving(true); await onSave(draft); setSaving(false); }}>
      <div className="editor-row">
        <label className="field grow"><span>Name</span><input value={draft.name} maxLength={MAX_NAME} onChange={(event) => set({ name: event.target.value })} /></label>
        <label className="field"><span>HP</span><input type="number" min={30} max={250} step={10} value={draft.hp} onChange={(event) => set({ hp: Number(event.target.value) })} /></label>
      </div>
      <div className="editor-row">
        <label className="field grow"><span>Title</span><input value={draft.title} maxLength={40} onChange={(event) => set({ title: event.target.value })} /></label>
        <label className="field"><span>Element</span>{elementSelect(draft.element, (value) => set({ element: value ?? draft.element }))}</label>
      </div>
      <div className="editor-row">
        <label className="field grow"><span>Ability</span><input value={draft.ability?.name ?? ""} maxLength={28} placeholder="No ability" onChange={(event) => set({ ability: event.target.value ? { name: event.target.value, text: draft.ability?.text ?? "" } : null })} /></label>
      </div>
      {draft.ability ? <label className="field"><span>Ability text</span><input value={draft.ability.text} maxLength={120} onChange={(event) => set({ ability: { name: draft.ability!.name, text: event.target.value } })} /></label> : null}
      {draft.attacks.map((attack, index) => (
        <div key={index} className="editor-attack">
          <div className="editor-row">
            <label className="field grow"><span>Move {index + 1}</span><input value={attack.name} maxLength={28} onChange={(event) => setAttack(index, { name: event.target.value })} /></label>
            <label className="field"><span>Cost</span><input type="number" min={1} max={4} value={attack.cost} onChange={(event) => setAttack(index, { cost: Number(event.target.value) })} /></label>
            <label className="field"><span>Damage</span><input value={attack.damage} maxLength={4} onChange={(event) => setAttack(index, { damage: event.target.value })} /></label>
          </div>
          <label className="field"><span>Text</span><input value={attack.text} maxLength={120} onChange={(event) => setAttack(index, { text: event.target.value })} /></label>
        </div>
      ))}
      <div className="editor-row">
        <label className="field"><span>Weak to</span>{elementSelect(draft.weakness, (value) => set({ weakness: value ?? draft.weakness }))}</label>
        <label className="field"><span>Resists</span>{elementSelect(draft.resistance, (value) => set({ resistance: value }), true)}</label>
        <label className="field"><span>Retreat</span><input type="number" min={0} max={4} value={draft.retreat} onChange={(event) => set({ retreat: Number(event.target.value) })} /></label>
      </div>
      <label className="field"><span>Flavor text</span><textarea rows={2} maxLength={200} value={draft.flavor} onChange={(event) => set({ flavor: event.target.value })} /></label>
      <div className="actions"><button className="ghost" type="submit" disabled={saving}>{saving ? "Saving…" : "Save the text"}</button></div>
    </form>
  );
}
