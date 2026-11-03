"use client";

// The card itself, drawn as one SVG of 630 by 880 units: the size ratio of a real trading card.
// Nine original frames: six for battle cards, two for sports cards and the glass card. The page exports this SVG to a PNG, so it uses system fonts only:
// an SVG drawn to a canvas cannot load web fonts. The card screen draws the glass card in 3D
// (components/glass.tsx). GlassFace here is its flat version, for the lists and the thumbnails.

import { forwardRef, useId } from "react";
import { ELEMENTS, FRAMES, type CardText, type ElementId, type FrameId } from "../lib/forge";

export const CARD_WIDTH = 630;
export const CARD_HEIGHT = 880;
// The art window of the framed cards, in card units. The art for them is drawn in the same shape.
export const ART_WINDOW = { x: 48, y: 96, width: 534, height: 370 };

const DISPLAY = "'Avenir Next Condensed', 'Futura', 'Gill Sans', 'Trebuchet MS', 'Arial Narrow', sans-serif";
const BODY = "'Avenir Next', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
const SERIF = "'Iowan Old Style', Georgia, 'Times New Roman', serif";

// White glyphs on a 24-unit grid, for the hexagon badges.
export const GLYPHS: Record<ElementId, string> = {
  fire: "M12 2c1.5 3.2 5.5 5.6 5.5 10.2A5.5 5.5 0 0 1 12 22a5.5 5.5 0 0 1-5.5-5.6c0-2.3 1.1-3.9 2.6-5.2.2 1.7 1 2.9 2.4 3.4-.6-3.6.2-6.4.5-12.6z",
  water: "M12 2.5c3.3 4.4 6.5 8.3 6.5 12a6.5 6.5 0 0 1-13 0c0-3.7 3.2-7.6 6.5-12z",
  nature: "M20 3.5C11 3.5 5 8 5 14.5c0 1.4.3 2.6.9 3.6L3.8 20.2l1.3 1.3 2.1-2.1c1 .6 2.2.9 3.5.9C17.3 20.3 20 13.8 20 3.5z",
  lightning: "M13.5 2 5 13.5h5.5L9.5 22 19 10h-5.6z",
  psychic: "M2 12c2.6-4.3 6.1-6.5 10-6.5s7.4 2.2 10 6.5c-2.6 4.3-6.1 6.5-10 6.5S4.6 16.3 2 12zm10 3.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z",
  earth: "M1.5 20 9 6.5l4.2 7.4L15.8 9.5 22.5 20z",
  shadow: "M15.5 2.5a9.5 9.5 0 1 0 6 16.8A8 8 0 0 1 15.5 2.5z",
  metal: "M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5zm0 6a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  air: "M3 8.5h10.5a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H3zm0 4h15.5a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3zM3 16.5h7v2H3z",
  light: "M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z",
};

function hexagon(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = Math.PI / 6 + (i * Math.PI) / 3;
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

// An element badge: a hexagon in the element's color with its white glyph.
export function Badge({ element, x, y, r, neutral = false }: { element: ElementId; x: number; y: number; r: number; neutral?: boolean }) {
  const color = neutral ? "#b9bec7" : ELEMENTS[element].color;
  const scale = (r * 1.15) / 24;
  return (
    <g>
      <polygon points={hexagon(x, y, r)} fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth={r * 0.09} />
      <polygon points={hexagon(x, y, r * 0.78)} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={r * 0.06} />
      {neutral
        ? <circle cx={x} cy={y} r={r * 0.28} fill="#fff" />
        : <path d={GLYPHS[element]} fill="#fff" fillRule="evenodd" transform={`translate(${x - 12 * scale} ${y - 12 * scale}) scale(${scale})`} />}
    </g>
  );
}

// Splits text into lines that fit a width, from an average glyph width. Exact enough for short card text.
function wrap(text: string, width: number, size: number, glyph = 0.5) {
  const max = Math.max(8, Math.floor(width / (size * glyph)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line ? `${line} ${word}` : word).length > max && line) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function Lines({ text, x, y, width, size, lineHeight = 1.22, max = 3, glyph, ...rest }: { text: string; x: number; y: number; width: number; size: number; lineHeight?: number; max?: number; glyph?: number } & React.SVGProps<SVGTextElement>) {
  const lines = wrap(text, width, size, glyph).slice(0, max);
  return (
    <text x={x} y={y} fontSize={size} {...rest}>
      {lines.map((line, index) => <tspan key={index} x={x} dy={index === 0 ? 0 : size * lineHeight}>{line}</tspan>)}
    </text>
  );
}

const linesOf = (text: string, width: number, size: number, max: number, glyph?: number) => Math.min(max, wrap(text, width, size, glyph).length);

// The text colors of each frame. "panel" is the box behind the moves on a full-art frame, and
// "shadow" lifts light text off the art.
type Palette = {
  ink: string; soft: string; accent: string; damage: string; line: string; footer: string;
  badge: string; badgeInk: string; panel?: string; shadow: boolean;
};

function palette(frame: FrameId): Palette {
  const light = { ink: "#ffffff", soft: "rgba(255,255,255,0.82)", accent: "#ffe58a", damage: "#ffffff", line: "rgba(255,255,255,0.35)", footer: "rgba(255,255,255,0.78)", badge: "#ffe58a", badgeInk: "#2a1a00", shadow: true };
  switch (frame) {
    case "gold": return { ...light, ink: "#fff7da", soft: "rgba(255,240,200,0.82)", accent: "#ffd76a", damage: "#fff3c4", badge: "#ffd76a", panel: "rgba(40,25,2,0.74)", line: "rgba(255,215,106,0.55)" };
    case "full": return { ...light, panel: "rgba(8,10,20,0.7)" };
    case "illustration": return { ...light, soft: "rgba(255,255,255,0.88)", line: "rgba(255,255,255,0.42)", badge: "rgba(255,255,255,0.92)", badgeInk: "#1b1b24" };
    case "rainbow": return { ink: "#2b2342", soft: "rgba(43,35,66,0.86)", accent: "#6d3fc4", damage: "#2b2342", line: "rgba(90,70,150,0.35)", footer: "rgba(43,35,66,0.78)", badge: "#6d3fc4", badgeInk: "#fff", panel: "rgba(255,255,255,0.55)", shadow: false };
    default: return { ink: "#1c1a17", soft: "#3b3832", accent: "#b3261e", damage: "#1c1a17", line: "rgba(40,30,20,0.35)", footer: "#5a5346", badge: "#c8432f", badgeInk: "#fff", shadow: false };
  }
}

// The outer border of the full-art frames: its inset from the card edge, its width and its paint.
const BORDERS: Partial<Record<FrameId, { inset: number; width: number; paint: string }>> = {
  full: { inset: 7, width: 12, paint: "silver" },
  gold: { inset: 8, width: 16, paint: "gold" },
  illustration: { inset: 5, width: 8, paint: "silver" },
  rainbow: { inset: 7, width: 12, paint: "rainbow" },
};

const RARITY: Record<FrameId, string> = {
  vintage: "✦ Holo", modern: "✧", full: "✦ Full art", gold: "✦✦ Gold rare", illustration: "✦✦ Illustration rare", rainbow: "✦✦✦ Rainbow rare",
  chrome: "✦ Chrome", retro: "Retro", glass: "✦✦ Future glass",
};

// The pastel colors of the rainbow frame, from corner to corner.
const RAINBOW = ["#ff9ad5", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#bdb2ff", "#ffc6ff"];

export type CardProps = {
  text: CardText;
  art: string | null;
  frame: FrameId;
  number: number;
  setSize: number;
  className?: string;
};

// Name and HP, the art, the moves, the stats and the footer. Full-art frames put the text over the art:
// on a panel, or for the illustration rare on a soft shadow, so more of the art shows.
export const Card = forwardRef<SVGSVGElement, CardProps>(function Card({ text, art, frame, number, setSize, className }, ref) {
  const id = useId().replace(/[^a-z0-9]/gi, "");
  const element = ELEMENTS[text.element];
  if (FRAMES[frame].face !== "battle") {
    return (
      <svg ref={ref} className={className} viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${text.name}, ${element.label} card`}>
        {FRAMES[frame].face === "glass"
          ? <GlassFace text={text} art={art} number={number} setSize={setSize} id={id} />
          : <SportsFace text={text} art={art} frame={frame} number={number} id={id} />}
      </svg>
    );
  }
  const full = FRAMES[frame].layout === "full";
  const illustration = frame === "illustration";
  const rainbow = frame === "rainbow";
  const border = BORDERS[frame];
  const colors = palette(frame);
  const window = frame === "modern" ? { x: 36, y: 92, width: 558, height: 386 } : ART_WINDOW;
  const left = full ? 52 : 44;
  const right = CARD_WIDTH - left;
  const textWidth = right - left;

  const statsY = illustration ? 800 : full ? 790 : 768;
  // The moves are laid out from the bottom of the art down, or on the lower panel for full art.
  // When two-line texts would run into the stats row, every text gets one line.
  const top = illustration ? 600 : full ? 560 : window.y + window.height + 58;
  const moves = (lines: number) => {
    let y = top;
    const nodes: React.ReactNode[] = [];
    if (text.ability) {
      const count = linesOf(text.ability.text, textWidth, 14.5, lines);
      nodes.push(
        <g key="ability">
          <rect x={left} y={y - 16} width={74} height={22} rx={5} fill={colors.badge} />
          <text x={left + 37} y={y} fontSize={13} fontWeight={800} fill={colors.badgeInk} textAnchor="middle" fontFamily={DISPLAY} letterSpacing={1}>ABILITY</text>
          <text x={left + 86} y={y + 1} fontSize={21} fontWeight={700} fill={colors.accent} fontFamily={DISPLAY}>{text.ability.name}</text>
          <Lines text={text.ability.text} x={left} y={y + 22} width={textWidth} size={14.5} max={lines} fill={colors.soft} fontFamily={BODY} />
        </g>,
      );
      y += 22 + count * 17 + 16;
    }
    text.attacks.forEach((attack, index) => {
      const count = attack.text ? linesOf(attack.text, textWidth, 14.5, lines) : 0;
      nodes.push(
        <g key={`attack-${index}`}>
          {Array.from({ length: attack.cost }, (_, i) => <Badge key={i} element={text.element} x={left + 12 + i * 26} y={y - 7} r={12} />)}
          <text x={left + attack.cost * 26 + 14} y={y} fontSize={24} fontWeight={700} fill={colors.ink} fontFamily={DISPLAY}>{attack.name}</text>
          {attack.damage ? <text x={right} y={y + 1} fontSize={30} fontWeight={700} fill={colors.damage} textAnchor="end" fontFamily={DISPLAY}>{attack.damage}</text> : null}
          {attack.text ? <Lines text={attack.text} x={left} y={y + 22} width={textWidth} size={14.5} max={lines} fill={colors.soft} fontFamily={BODY} /> : null}
        </g>,
      );
      y += (count ? 22 + count * 17 : 12) + 18;
    });
    return { nodes, end: y };
  };
  const roomy = moves(2);
  const blocks = roomy.end <= statsY - 22 ? roomy.nodes : moves(1).nodes;

  const flavorY = illustration ? 830 : full ? 822 : 798;
  const shadow = colors.shadow ? `url(#shadow-${id})` : undefined;
  const nameSize = text.name.length > 16 ? 30 : 36;

  return (
    <svg ref={ref} className={className} viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${text.name}, ${element.label} card`}>
      <defs>
        <clipPath id={`card-${id}`}><rect width={CARD_WIDTH} height={CARD_HEIGHT} rx={28} /></clipPath>
        <clipPath id={`window-${id}`}><rect x={window.x} y={window.y} width={window.width} height={window.height} rx={frame === "modern" ? 12 : 3} /></clipPath>
        <linearGradient id={`panel-${id}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={element.light} />
          <stop offset="0.55" stopColor="#fbf7ee" />
          <stop offset="1" stopColor={element.light} />
        </linearGradient>
        <linearGradient id={`modern-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={element.color} />
          <stop offset="0.16" stopColor={element.light} />
          <stop offset="0.6" stopColor="#f7f8fa" />
          <stop offset="1" stopColor="#e9ecf0" />
        </linearGradient>
        <linearGradient id={`warm-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f9de7f" />
          <stop offset="0.5" stopColor="#e8b444" />
          <stop offset="1" stopColor="#f6d36b" />
        </linearGradient>
        <linearGradient id={`silver-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2f4f7" />
          <stop offset="0.5" stopColor="#a8b0bb" />
          <stop offset="1" stopColor="#e4e8ed" />
        </linearGradient>
        <linearGradient id={`gold-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1b0" />
          <stop offset="0.3" stopColor="#d9a233" />
          <stop offset="0.55" stopColor="#fbe08a" />
          <stop offset="0.8" stopColor="#b9801f" />
          <stop offset="1" stopColor="#f7d77a" />
        </linearGradient>
        <linearGradient id={`top-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={rainbow ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.62)"} />
          <stop offset="1" stopColor={rainbow ? "rgba(255,255,255,0)" : "rgba(0,0,0,0)"} />
        </linearGradient>
        <linearGradient id={`bottom-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(0,0,0,0)" />
          <stop offset="0.38" stopColor="rgba(0,0,0,0.5)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.84)" />
        </linearGradient>
        <linearGradient id={`rainbow-${id}`} x1="0" y1="0" x2="1" y2="1">
          {RAINBOW.map((color, index) => <stop key={color} offset={index / (RAINBOW.length - 1)} stopColor={color} />)}
        </linearGradient>
        {/* The rainbow frame fades the art to a light, nearly gray picture, and the rainbow tints it. */}
        <filter id={`pastel-${id}`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0.2" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.76" intercept="0.26" />
            <feFuncG type="linear" slope="0.76" intercept="0.26" />
            <feFuncB type="linear" slope="0.76" intercept="0.26" />
          </feComponentTransfer>
        </filter>
        <filter id={`shadow-${id}`} x="-10%" y="-30%" width="120%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>

      <g clipPath={`url(#card-${id})`}>
        {full ? (
          <>
            <rect width={CARD_WIDTH} height={CARD_HEIGHT} fill="#111" />
            {art ? <image href={art} x={0} y={0} width={CARD_WIDTH} height={CARD_HEIGHT} preserveAspectRatio="xMidYMid slice" filter={rainbow ? `url(#pastel-${id})` : undefined} /> : null}
            {rainbow ? <rect width={CARD_WIDTH} height={CARD_HEIGHT} fill={`url(#rainbow-${id})`} style={{ mixBlendMode: "multiply" }} /> : null}
            <rect width={CARD_WIDTH} height={150} fill={`url(#top-${id})`} />
            {colors.panel ? (
              <rect x={28} y={top - 44} width={CARD_WIDTH - 56} height={CARD_HEIGHT - top + 14} rx={18} fill={colors.panel} stroke={colors.line} strokeWidth={1.5} />
            ) : (
              <rect y={top - 170} width={CARD_WIDTH} height={CARD_HEIGHT - top + 170} fill={`url(#bottom-${id})`} />
            )}
          </>
        ) : (
          <>
            <rect width={CARD_WIDTH} height={CARD_HEIGHT} fill={frame === "vintage" ? `url(#warm-${id})` : `url(#silver-${id})`} />
            <rect x={frame === "vintage" ? 20 : 11} y={frame === "vintage" ? 20 : 11} width={CARD_WIDTH - (frame === "vintage" ? 40 : 22)} height={CARD_HEIGHT - (frame === "vintage" ? 40 : 22)}
              rx={frame === "vintage" ? 14 : 20} fill={frame === "vintage" ? `url(#panel-${id})` : `url(#modern-${id})`} />
            {/* The art window, with a beveled edge. */}
            <rect x={window.x - 7} y={window.y - 7} width={window.width + 14} height={window.height + 14} rx={frame === "modern" ? 16 : 6}
              fill={frame === "vintage" ? `url(#silver-${id})` : element.color} />
            <rect x={window.x} y={window.y} width={window.width} height={window.height} fill="#222" />
            {art ? <image href={art} x={window.x} y={window.y} width={window.width} height={window.height} preserveAspectRatio="xMidYMid slice" clipPath={`url(#window-${id})`} /> : null}
            {/* The title strip under the art. */}
            <rect x={window.x + 30} y={window.y + window.height + 7} width={window.width - 60} height={24} rx={frame === "modern" ? 12 : 3}
              fill={frame === "vintage" ? `url(#warm-${id})` : "rgba(255,255,255,0.75)"} stroke="rgba(0,0,0,0.15)" />
            <text x={CARD_WIDTH / 2} y={window.y + window.height + 24} fontSize={13.5} fontStyle="italic" fill="#3a352c" textAnchor="middle" fontFamily={BODY}>
              {[text.title, `${element.label} type`, `No. ${String(number).padStart(3, "0")}`].filter(Boolean).join("  ·  ")}
            </text>
          </>
        )}

        {/* Name, HP and element. */}
        <g filter={shadow}>
          <text x={left} y={full ? 70 : 72} fontSize={nameSize} fontWeight={800} fill={frame === "gold" ? `url(#gold-${id})` : colors.ink} fontFamily={DISPLAY} letterSpacing={0.3}>{text.name}</text>
          <text x={right - 52} y={full ? 70 : 72} fontSize={15} fontWeight={800} fill={full ? colors.soft : colors.accent} textAnchor="end" fontFamily={DISPLAY}>
            <tspan>HP</tspan><tspan fontSize={34} dx={4} fill={full ? colors.ink : colors.accent}>{text.hp}</tspan>
          </text>
          <Badge element={text.element} x={right - 22} y={full ? 58 : 60} r={20} />
          {full && text.title ? <text x={left} y={100} fontSize={15} fontStyle="italic" fill={colors.soft} fontFamily={BODY}>{text.title} · {element.label} type</text> : null}
        </g>

        {/* The moves. */}
        <g filter={shadow}>{blocks}</g>

        {/* Weakness, resistance and retreat. */}
        <line x1={left} x2={right} y1={statsY - 26} y2={statsY - 26} stroke={colors.line} strokeWidth={1.2} />
        <g fontFamily={DISPLAY} fontSize={12} fontWeight={700} fill={colors.soft} letterSpacing={0.8} filter={illustration ? shadow : undefined}>
          <text x={left} y={statsY - 6}>WEAK TO</text>
          <Badge element={text.weakness} x={left + 72} y={statsY - 10} r={11} />
          <text x={left + 88} y={statsY - 5} fontSize={16} fill={colors.ink}>×2</text>
          <text x={left + 190} y={statsY - 6}>RESISTS</text>
          {text.resistance ? (
            <>
              <Badge element={text.resistance} x={left + 255} y={statsY - 10} r={11} />
              <text x={left + 271} y={statsY - 5} fontSize={16} fill={colors.ink}>−30</text>
            </>
          ) : <text x={left + 252} y={statsY - 5} fontSize={16} fill={colors.ink}>—</text>}
          <text x={left + 378} y={statsY - 6}>RETREAT</text>
          {text.retreat ? Array.from({ length: text.retreat }, (_, i) => <Badge key={i} element={text.element} neutral x={left + 450 + i * 22} y={statsY - 10} r={10} />)
            : <text x={left + 444} y={statsY - 5} fontSize={16} fill={colors.ink}>0</text>}
        </g>

        {/* Flavor text and the footer. */}
        {text.flavor ? (
          <Lines text={text.flavor} x={left} y={flavorY} width={textWidth} size={13} max={2} fill={colors.soft} fontStyle="italic" fontFamily={SERIF} lineHeight={1.25} glyph={0.47} filter={illustration ? shadow : undefined} />
        ) : null}
        <text x={left} y={CARD_HEIGHT - (full ? 18 : 30)} fontSize={10.5} fill={colors.footer} fontFamily={BODY}>Illus. Qwen Image Edit · Card Forge</text>
        <text x={right} y={CARD_HEIGHT - (full ? 18 : 30)} fontSize={10.5} fontWeight={700} fill={colors.footer} textAnchor="end" fontFamily={BODY}>
          {`${String(number).padStart(3, "0")}/${setSize}  ${RARITY[frame]}`}
        </text>

        {/* The border of a full-art frame sits on top of the art. The illustration rare adds a thin inner line. */}
        {border ? (
          <rect x={border.inset} y={border.inset} width={CARD_WIDTH - 2 * border.inset} height={CARD_HEIGHT - 2 * border.inset} rx={22}
            fill="none" stroke={`url(#${border.paint}-${id})`} strokeWidth={border.width} />
        ) : null}
        {illustration ? <rect x={12} y={12} width={CARD_WIDTH - 24} height={CARD_HEIGHT - 24} rx={17} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.2} /> : null}
      </g>
    </svg>
  );
});

// Fits a name to a width: a long name is squeezed instead of running off the card.
function Name({ text, width, size, ...rest }: { text: string; width: number; size: number } & React.SVGProps<SVGTextElement>) {
  const squeeze = text.length * size * 0.52 > width;
  return <text fontSize={size} {...rest} {...(squeeze ? { textLength: width, lengthAdjust: "spacingAndGlyphs" } : {})}>{text}</text>;
}

// The front of a sports card: the art, a nameplate with the name and the title, and the element
// badge in place of a team logo. No moves, like a ball card. The chrome card has a made-up serial number.
function SportsFace({ text, art, frame, number, id }: { text: CardText; art: string | null; frame: FrameId; number: number; id: string }) {
  const element = ELEMENTS[text.element];
  const name = text.name.toUpperCase();
  const credit = "Illus. Qwen Image Edit · Card Forge";

  if (frame === "chrome") {
    const photo = { x: 18, y: 18, width: CARD_WIDTH - 36, height: CARD_HEIGHT - 36 };
    const serial = `${String(((number * 37) % 99) + 1).padStart(2, "0")}/99`;
    return (
      <>
        <defs>
          <clipPath id={`card-${id}`}><rect width={CARD_WIDTH} height={CARD_HEIGHT} rx={28} /></clipPath>
          <clipPath id={`photo-${id}`}><rect {...photo} rx={14} /></clipPath>
          <linearGradient id={`chrome-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fdfdfd" />
            <stop offset="0.22" stopColor="#9aa3ad" />
            <stop offset="0.45" stopColor="#eef1f4" />
            <stop offset="0.7" stopColor="#7c858f" />
            <stop offset="1" stopColor="#f5f7f9" />
          </linearGradient>
          <linearGradient id={`plate-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={element.color} />
            <stop offset="1" stopColor={element.light} />
          </linearGradient>
          <linearGradient id={`stamp-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff1b0" />
            <stop offset="0.5" stopColor="#d9a233" />
            <stop offset="1" stopColor="#fbe08a" />
          </linearGradient>
          <filter id={`shadow-${id}`} x="-10%" y="-30%" width="120%" height="160%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="#000" floodOpacity="0.6" />
          </filter>
        </defs>
        <g clipPath={`url(#card-${id})`}>
          <rect width={CARD_WIDTH} height={CARD_HEIGHT} fill={`url(#chrome-${id})`} />
          {/* A thin edge in the element color, like a color refractor. */}
          <rect x={photo.x - 4} y={photo.y - 4} width={photo.width + 8} height={photo.height + 8} rx={17} fill={element.color} />
          <rect {...photo} rx={14} fill="#111" />
          {art ? <image href={art} {...photo} preserveAspectRatio="xMidYMid slice" clipPath={`url(#photo-${id})`} /> : null}
          {/* The nameplate, on a slant. */}
          <g clipPath={`url(#photo-${id})`}>
            <polygon points={`0,706 ${CARD_WIDTH},668 ${CARD_WIDTH},${CARD_HEIGHT} 0,${CARD_HEIGHT}`} fill="rgba(8,10,18,0.84)" />
            <polygon points={`0,706 ${CARD_WIDTH},668 ${CARD_WIDTH},677 0,715`} fill={`url(#plate-${id})`} />
          </g>
          <Name text={name} width={440} size={name.length > 14 ? 34 : 42} x={44} y={780} fontWeight={800} fontStyle="italic" fill="#fff" fontFamily={DISPLAY} letterSpacing={0.5} filter={`url(#shadow-${id})`} />
          <Name text={[text.title, `${element.label} type`].filter(Boolean).join("  ·  ").toUpperCase()} width={440} size={14} x={46} y={810} fontWeight={700} fill={element.light} fontFamily={DISPLAY} letterSpacing={2} />
          <Badge element={text.element} x={556} y={772} r={30} />
          <text x={46} y={846} fontSize={13} fontWeight={800} fill={`url(#stamp-${id})`} fontFamily={DISPLAY} letterSpacing={1.5}>{serial}</text>
          <text x={CARD_WIDTH - 44} y={846} fontSize={10.5} fill="rgba(255,255,255,0.72)" textAnchor="end" fontFamily={BODY}>{credit}</text>
          {/* The prospect tag and the chrome mark. */}
          <rect x={36} y={36} width={140} height={30} rx={15} fill={`url(#chrome-${id})`} stroke="rgba(0,0,0,0.35)" />
          <text x={106} y={56} fontSize={14} fontWeight={800} fill="#1c2330" textAnchor="middle" fontFamily={DISPLAY} letterSpacing={2.5}>★ PROSPECT</text>
          <text x={CARD_WIDTH - 40} y={58} fontSize={16} fontWeight={800} fontStyle="italic" fill="#fff" textAnchor="end" fontFamily={DISPLAY} letterSpacing={2} filter={`url(#shadow-${id})`}>✦ CHROME</text>
        </g>
      </>
    );
  }

  const photo = { x: 34, y: 34, width: CARD_WIDTH - 68, height: 690 };
  return (
    <>
      <defs>
        <clipPath id={`card-${id}`}><rect width={CARD_WIDTH} height={CARD_HEIGHT} rx={28} /></clipPath>
        <clipPath id={`photo-${id}`}><rect {...photo} rx={6} /></clipPath>
      </defs>
      <g clipPath={`url(#card-${id})`}>
        {/* Cream card stock with a thin border in the element color. */}
        <rect width={CARD_WIDTH} height={CARD_HEIGHT} fill="#f3ead3" />
        <rect x={20} y={20} width={CARD_WIDTH - 40} height={CARD_HEIGHT - 40} rx={12} fill="none" stroke={element.color} strokeWidth={3} />
        <rect {...photo} rx={6} fill="#222" />
        {art ? <image href={art} {...photo} preserveAspectRatio="xMidYMid slice" clipPath={`url(#photo-${id})`} /> : null}
        <rect {...photo} rx={6} fill="none" stroke="#2a2418" strokeWidth={2} />
        {/* The name banner, and the round badge where a team logo would go. */}
        <rect x={photo.x} y={740} width={photo.width} height={58} rx={4} fill={element.color} />
        <Name text={name} width={480} size={name.length > 16 ? 30 : 38} x={56} y={782} fontWeight={800} fill="#fff" fontFamily={DISPLAY} letterSpacing={1.5} />
        <Name text={[text.title, `${element.label} type`].filter(Boolean).join("  ·  ")} width={510} size={17} x={56} y={828} fontStyle="italic" fill="#3a3122" fontFamily={SERIF} />
        <circle cx={548} cy={694} r={46} fill={element.light} stroke="#2a2418" strokeWidth={3} />
        <Badge element={text.element} x={548} y={694} r={30} />
        <text x={56} y={856} fontSize={10.5} fill="#6a5f4a" fontFamily={BODY}>{credit}</text>
        <text x={CARD_WIDTH - 56} y={856} fontSize={10.5} fontWeight={700} fill="#6a5f4a" textAnchor="end" fontFamily={BODY}>No. {String(number).padStart(3, "0")}</text>
      </g>
    </>
  );
}

// A rectangle with cut corners, as SVG points. Corners go top left, top right, bottom right, bottom left.
function chamfer(x: number, y: number, width: number, height: number, [tl, tr, br, bl]: number[]) {
  return [
    [x + tl, y], [x + width - tr, y], [x + width, y + tr], [x + width, y + height - br],
    [x + width - br, y + height], [x + bl, y + height], [x, y + height - bl], [x, y + tl],
  ].map((point) => point.join(",")).join(" ");
}

// The glass card seen straight on: the metal frame, the glass with its hex grid, the person on the
// lit nameplate, and the element badge on the corner. The 3D card uses the same sizes.
function GlassFace({ text, art, number, setSize, id }: { text: CardText; art: string | null; number: number; setSize: number; id: string }) {
  const element = ELEMENTS[text.element];
  const glass = { x: 26, y: 36, width: 578, height: 808 };
  const floor = glass.y + glass.height - 205;
  const name = text.name.toUpperCase();
  return (
    <>
      <defs>
        <clipPath id={`card-${id}`}><polygon points={chamfer(0, 0, CARD_WIDTH, CARD_HEIGHT, [22, 85, 22, 85])} /></clipPath>
        <clipPath id={`glass-${id}`}><polygon points={chamfer(glass.x, glass.y, glass.width, glass.height, [12, 70, 12, 70])} /></clipPath>
        <linearGradient id={`metal-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5a616d" />
          <stop offset="0.35" stopColor="#262a32" />
          <stop offset="0.6" stopColor="#3c424c" />
          <stop offset="1" stopColor="#1b1e24" />
        </linearGradient>
        <radialGradient id={`aura-${id}`} cx="0.5" cy="0.55" r="0.65">
          <stop offset="0" stopColor={element.color} stopOpacity="0.4" />
          <stop offset="1" stopColor={element.color} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`plate-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#060910" stopOpacity="0.55" />
          <stop offset="0.35" stopColor="#060910" stopOpacity="0.86" />
          <stop offset="1" stopColor="#060910" stopOpacity="0.94" />
        </linearGradient>
        <pattern id={`hex-${id}`} width={29.4} height={51} patternUnits="userSpaceOnUse">
          <path d="M14.7 0 29.4 8.5V25.5L14.7 34 0 25.5V8.5zM14.7 34V51M0 8.5 -14.7 0M29.4 8.5 44.1 0" fill="none" stroke={element.light} strokeOpacity="0.16" strokeWidth={1} />
        </pattern>
      </defs>
      <g clipPath={`url(#card-${id})`}>
        <rect width={CARD_WIDTH} height={CARD_HEIGHT} fill={`url(#metal-${id})`} />
        <g clipPath={`url(#glass-${id})`}>
          <rect {...glass} fill="#0a0d15" />
          <rect {...glass} fill={`url(#aura-${id})`} />
          <rect {...glass} fill={`url(#hex-${id})`} />
          {art ? <image href={art} x={glass.x + 40} y={glass.y + 78} width={glass.width - 80} height={floor - glass.y - 76} preserveAspectRatio="xMidYMax meet" /> : null}
          <rect x={glass.x} y={floor} width={glass.width} height={glass.y + glass.height - floor} fill={`url(#plate-${id})`} />
          <rect x={glass.x} y={floor - 2} width={glass.width} height={4} fill={element.light} />
        </g>
        <line x1={13} x2={13} y1={180} y2={620} stroke={element.light} strokeWidth={4.5} strokeLinecap="round" />
        <polyline points={`${glass.x + 23},${glass.y + 77} ${glass.x + 23},${glass.y + 23} ${glass.x + 50},${glass.y + 23}`} fill="none" stroke={element.light} strokeOpacity="0.75" strokeWidth={1.5} />
        <text x={glass.x + 36} y={glass.y + 54} fontSize={13} fontWeight={700} fill={element.light} fontFamily={DISPLAY} letterSpacing={2.5}>NO. {String(number).padStart(3, "0")} / {setSize}</text>
        <text x={glass.x + 36} y={glass.y + 80} fontSize={10} fontWeight={700} fill={element.light} fontFamily={DISPLAY} letterSpacing={2.5}>✦✦ FUTURE GLASS</text>
        <text x={glass.x + glass.width - 82} y={glass.y + 75} fontSize={46} fontWeight={800} fill="#fff" textAnchor="end" fontFamily={DISPLAY}>
          <tspan fontSize={15} fill={element.light} dx={0} letterSpacing={2}>HP </tspan>{text.hp}
        </text>
        <Name text={name} width={400} size={name.length > 14 ? 34 : 44} x={glass.x + 38} y={floor + 52} fontWeight={800} fill="#fff" fontFamily={DISPLAY} letterSpacing={1.5} />
        <Name text={[text.title, `${element.label} type`].filter(Boolean).join("  ·  ").toUpperCase()} width={400} size={13} x={glass.x + 38} y={floor + 74} fontWeight={700} fill={element.light} fontFamily={DISPLAY} letterSpacing={2} />
        <rect x={glass.x + 38} y={floor + 88} width={glass.width - 76} height={1} fill={element.light} opacity={0.35} />
        {text.attacks.slice(0, 2).map((attack, index) => (
          <g key={index}>
            {Array.from({ length: attack.cost }, (_, i) => <circle key={i} cx={glass.x + 43 + i * 14} cy={floor + 110 + index * 29} r={5} fill={element.color} />)}
            <text x={glass.x + 43 + attack.cost * 14} y={floor + 116 + index * 29} fontSize={18} fontWeight={700} fill="#fff" fontFamily={DISPLAY}>{attack.name}</text>
            {attack.damage ? <text x={glass.x + glass.width - 38} y={floor + 117 + index * 29} fontSize={21} fontWeight={800} fill={element.light} textAnchor="end" fontFamily={DISPLAY}>{attack.damage}</text> : null}
          </g>
        ))}
        <text x={CARD_WIDTH / 2 - 20} y={glass.y + glass.height - 27} fontSize={8.5} fill="rgba(255,255,255,0.6)" textAnchor="middle" fontFamily={BODY} letterSpacing={1}>Illus. Qwen Image Edit · Card Forge</text>
        <circle cx={CARD_WIDTH - 50} cy={CARD_HEIGHT - 50} r={44} fill={`url(#metal-${id})`} stroke="#1b1e24" strokeWidth={2} />
        <circle cx={CARD_WIDTH - 50} cy={CARD_HEIGHT - 50} r={36} fill={element.color} stroke={element.light} strokeWidth={3} />
        <path d={GLYPHS[text.element]} fill="#fff" fillRule="evenodd" transform={`translate(${CARD_WIDTH - 50 - 12 * 1.9} ${CARD_HEIGHT - 50 - 12 * 1.9}) scale(1.9)`} />
      </g>
    </>
  );
}
