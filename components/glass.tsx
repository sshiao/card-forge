"use client";

// The glass card, drawn in 3D with Three.js: a metal frame with neon edges holds two glass panes,
// and the person, cut out of the art by BiRefNet, stands between them on a lit nameplate.
// Drag the card to turn it. The card screen shows it for the "glass" frame and exports a PNG and
// a turntable video from it. The text is drawn on canvases with system fonts, like the flat cards.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ELEMENTS, type CardText } from "../lib/forge";
import { GLYPHS } from "./card";

export type GlassHandle = {
  png(name: string): Promise<void>;
  video(name: string): Promise<void>;
};

type Props = { text: CardText; art: string; number: number; setSize: number; onFail: () => void };

const DISPLAY = "'Avenir Next Condensed', 'Futura', 'Gill Sans', 'Trebuchet MS', 'Arial Narrow', sans-serif";
const BODY = "'Avenir Next', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";

// The card is 6.3 by 8.8 units, the ratio of a real trading card. The window is the glass inside the frame.
const W = 6.3;
const H = 8.8;
const DEPTH = 0.34;
const WINDOW = { width: 5.78, height: 8.08 };
// The nameplate fills the bottom of the window. The person stands on its top edge.
const PLATE = 2.05;
// Pixels per unit on the text canvases.
const PX = 200;

const PNG_SIZE = { width: 1260, height: 1760 };
const VIDEO_SIZE = { width: 1080, height: 1920 };
const VIDEO_SECONDS = 6;
const VIDEO_FPS = 30;

// A rectangle with cut corners, centered on 0, 0. Corners go top left, top right, bottom right, bottom left.
function chamfered(width: number, height: number, [tl, tr, br, bl]: number[]) {
  const x = width / 2;
  const y = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + tl, y);
  shape.lineTo(x - tr, y);
  shape.lineTo(x, y - tr);
  shape.lineTo(x, -y + br);
  shape.lineTo(x - br, -y);
  shape.lineTo(-x + bl, -y);
  shape.lineTo(-x, -y + bl);
  shape.lineTo(-x, y - tl);
  shape.closePath();
  return shape;
}

const OUTER_CUTS = [0.22, 0.85, 0.22, 0.85];
const WINDOW_CUTS = [0.12, 0.7, 0.12, 0.7];

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return [element, element.getContext("2d")!] as const;
}

function texture(source: HTMLCanvasElement) {
  const result = new THREE.CanvasTexture(source);
  result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 8;
  return result;
}

// Draws text with letter spacing where the browser supports it.
function spaced(ctx: CanvasRenderingContext2D, spacing: number) {
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
}

// Shrinks a font until the text fits a width.
function fit(ctx: CanvasRenderingContext2D, text: string, weight: string, size: number, family: string, width: number) {
  let current = size;
  do {
    ctx.font = `${weight} ${current}px ${family}`;
    current -= 2;
  } while (ctx.measureText(text).width > width && current > 12);
}

// The front pane: corner brackets, the number and the HP at the top, and the nameplate with the
// name, the title and the two moves at the bottom.
function frontTexture(text: CardText, number: number, setSize: number) {
  const width = WINDOW.width * PX;
  const height = WINDOW.height * PX;
  const [element, ctx] = canvas(width, height);
  const colors = ELEMENTS[text.element];
  const pad = 46;

  // A bracket in the square top left corner, and a line along each cut corner.
  const cut = WINDOW_CUTS[1] * PX;
  ctx.strokeStyle = colors.light;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(pad, pad + 54);
  ctx.lineTo(pad, pad);
  ctx.lineTo(pad + 54, pad);
  ctx.moveTo(width - cut - 8, 34);
  ctx.lineTo(width - 62, cut + 20);
  ctx.moveTo(34, height - cut - 8);
  ctx.lineTo(cut + 20, height - 62);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The number and the HP.
  ctx.fillStyle = colors.light;
  spaced(ctx, 5);
  ctx.font = `700 26px ${DISPLAY}`;
  ctx.fillText(`NO. ${String(number).padStart(3, "0")} / ${setSize}`, pad + 26, pad + 62);
  ctx.globalAlpha = 0.6;
  ctx.fillRect(pad + 26, pad + 80, 210, 2);
  ctx.globalAlpha = 1;
  ctx.font = `700 20px ${DISPLAY}`;
  ctx.fillText("✦✦ FUTURE GLASS", pad + 26, pad + 114);
  // The HP stays clear of the cut top right corner.
  const hpRight = width - cut - 24;
  ctx.textAlign = "right";
  ctx.shadowColor = colors.color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#ffffff";
  spaced(ctx, 1);
  ctx.font = `800 92px ${DISPLAY}`;
  const hp = String(text.hp);
  ctx.fillText(hp, hpRight, pad + 104);
  const hpWidth = ctx.measureText(hp).width;
  ctx.shadowBlur = 0;
  ctx.fillStyle = colors.light;
  ctx.font = `700 30px ${DISPLAY}`;
  spaced(ctx, 4);
  ctx.fillText("HP", hpRight - 8 - hpWidth, pad + 100);
  ctx.textAlign = "left";

  // The nameplate, with a lit top edge for the person to stand on.
  const top = height - PLATE * PX;
  const plate = ctx.createLinearGradient(0, top, 0, height);
  plate.addColorStop(0, "rgba(6,9,16,0.55)");
  plate.addColorStop(0.35, "rgba(6,9,16,0.86)");
  plate.addColorStop(1, "rgba(6,9,16,0.94)");
  ctx.fillStyle = plate;
  ctx.fillRect(0, top, width, height - top);
  const edge = ctx.createLinearGradient(0, 0, width, 0);
  edge.addColorStop(0, "rgba(255,255,255,0)");
  edge.addColorStop(0.2, colors.light);
  edge.addColorStop(0.8, colors.light);
  edge.addColorStop(1, "rgba(255,255,255,0)");
  ctx.shadowColor = colors.color;
  ctx.shadowBlur = 24;
  ctx.fillStyle = edge;
  ctx.fillRect(0, top - 2, width, 5);
  ctx.shadowBlur = 0;

  const left = pad + 30;
  const right = width - pad - 30;
  const name = text.name.toUpperCase();
  ctx.fillStyle = "#ffffff";
  spaced(ctx, 3);
  fit(ctx, name, "800", 88, DISPLAY, right - left - 150);
  ctx.fillText(name, left, top + 104);
  ctx.fillStyle = colors.light;
  spaced(ctx, 4);
  const subtitle = [text.title, `${colors.label} type`].filter(Boolean).join("  ·  ").toUpperCase();
  fit(ctx, subtitle, "700", 26, DISPLAY, right - left - 150);
  ctx.fillText(subtitle, left, top + 148);

  ctx.globalAlpha = 0.35;
  ctx.fillRect(left, top + 176, right - left, 2);
  ctx.globalAlpha = 1;
  text.attacks.slice(0, 2).forEach((attack, index) => {
    const y = top + 232 + index * 58;
    for (let i = 0; i < attack.cost; i += 1) {
      ctx.fillStyle = colors.color;
      ctx.beginPath();
      ctx.arc(left + 11 + i * 28, y - 11, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    spaced(ctx, 1);
    fit(ctx, attack.name, "700", 36, DISPLAY, right - left - 150 - attack.cost * 28);
    ctx.fillText(attack.name, left + attack.cost * 28 + 10, y);
    if (attack.damage) {
      ctx.textAlign = "right";
      ctx.fillStyle = colors.light;
      ctx.font = `800 42px ${DISPLAY}`;
      ctx.fillText(attack.damage, right, y + 2);
      ctx.textAlign = "left";
    }
  });

  // The credit is centered, clear of the cut bottom left corner and the badge.
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.textAlign = "center";
  spaced(ctx, 2);
  ctx.font = `500 17px ${BODY}`;
  ctx.fillText("Illus. Qwen Image Edit · Card Forge", width / 2 - 40, height - pad - 8);
  ctx.textAlign = "left";
  return texture(element);
}

// The back pane: a hex grid that fades toward the bottom, and the first word of the name in tall
// outlined letters behind the person.
function backTexture(text: CardText) {
  const width = WINDOW.width * PX;
  const height = WINDOW.height * PX;
  const [element, ctx] = canvas(width, height);
  const colors = ELEMENTS[text.element];
  const glow = ctx.createRadialGradient(width * 0.5, height * 0.55, 40, width * 0.5, height * 0.55, height * 0.6);
  glow.addColorStop(0, `${colors.color}55`);
  glow.addColorStop(1, `${colors.color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const r = 34;
  const stepX = r * Math.sqrt(3);
  ctx.strokeStyle = colors.light;
  ctx.lineWidth = 2;
  for (let row = 0; row * r * 1.5 < height + r; row += 1) {
    const y = row * r * 1.5;
    ctx.globalAlpha = 0.2 * (1 - y / height) + 0.04;
    for (let x = (row % 2) * (stepX / 2); x < width + stepX; x += stepX) {
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = Math.PI / 6 + (i * Math.PI) / 3;
        const px = x + r * 0.92 * Math.cos(angle);
        const py = y + r * 0.92 * Math.sin(angle);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // The word reads upward along the right edge, like a book spine, from just above the nameplate.
  const word = (text.name.split(/\s+/)[0] || text.name).toUpperCase();
  const floor = height - PLATE * PX - 30;
  ctx.save();
  ctx.translate(width - 64, floor);
  ctx.rotate(-Math.PI / 2);
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = colors.light;
  ctx.lineWidth = 3;
  spaced(ctx, 10);
  fit(ctx, word, "800", 230, DISPLAY, floor - WINDOW_CUTS[1] * PX - 40);
  ctx.strokeText(word, 0, 0);
  ctx.restore();
  return texture(element);
}

// The element badge: a disc in the element color with its white glyph.
function badgeTexture(text: CardText) {
  const size = 256;
  const [element, ctx] = canvas(size, size);
  const colors = ELEMENTS[text.element];
  const fill = ctx.createRadialGradient(size * 0.4, size * 0.35, 10, size / 2, size / 2, size / 2);
  fill.addColorStop(0, colors.light);
  fill.addColorStop(0.55, colors.color);
  fill.addColorStop(1, "#0b0e16");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const scale = 5.4;
  ctx.translate(size / 2 - 12 * scale, size / 2 - 12 * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 2;
  ctx.fill(new Path2D(GLYPHS[text.element]), "evenodd");
  return texture(element);
}

// A soft glowing line, stretched over each neon strip.
function glowTexture() {
  const [element, ctx] = canvas(256, 64);
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(36, 28, 184, 8);
  return texture(element);
}

// A soft round glow under the person's feet.
function padTexture(color: string) {
  const [element, ctx] = canvas(256, 64);
  const glow = ctx.createRadialGradient(128, 32, 2, 128, 32, 120);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.setTransform(1, 0, 0, 0.27, 0, 23);
  ctx.fillRect(0, 0, 256, 256);
  return texture(element);
}

// The opaque part of the art, as fractions of the picture, so the person stands on the plate.
// Art with no transparent background is opaque everywhere and fills the room above the plate.
function opaqueBounds(image: HTMLImageElement | ImageBitmap) {
  const width = 110;
  const height = Math.round((width * image.height) / image.width);
  const [, ctx] = canvas(width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 40) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (bottom < 0) return { top: 0, bottom: 1, left: 0, right: 1 };
  return { top: top / height, bottom: (bottom + 1) / height, left: left / width, right: (right + 1) / width };
}

// The background of the exported PNG and video: dark, with a glow in the element color.
function backdropTexture(text: CardText, width: number, height: number) {
  const [element, ctx] = canvas(width, height);
  const colors = ELEMENTS[text.element];
  ctx.fillStyle = "#06070b";
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, height * 0.45, 20, width / 2, height * 0.45, Math.max(width, height) * 0.6);
  glow.addColorStop(0, `${colors.color}66`);
  glow.addColorStop(1, `${colors.color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  return texture(element);
}

// The light the metal and the glass reflect. It lives on the GPU of one renderer, so each renderer makes its own.
function environment(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const result = pmrem.fromScene(room, 0.03).texture;
  room.traverse((item) => { if (item instanceof THREE.Mesh) { item.geometry.dispose(); (item.material as THREE.Material).dispose(); } });
  pmrem.dispose();
  return result;
}

type Scene = {
  scene: THREE.Scene;
  card: THREE.Group;
  front: THREE.Object3D[];
  back: THREE.Object3D[];
  dispose(): void;
};

// Builds the card. The frame is opaque metal. The panes, the person and the text are see-through,
// so they draw after it in a fixed order, and setSide flips that order when the back faces the camera.
function buildScene(text: CardText, art: THREE.Texture, number: number, setSize: number, renderer: THREE.WebGLRenderer): Scene {
  const colors = ELEMENTS[text.element];
  const scene = new THREE.Scene();
  const disposable: { dispose(): void }[] = [art];
  const keep = <T extends { dispose(): void }>(item: T) => { disposable.push(item); return item; };
  scene.environment = keep(environment(renderer));

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 6, 8);
  scene.add(key);
  const tint = new THREE.PointLight(new THREE.Color(colors.color), 30, 18);
  tint.position.set(4, -2, 4);
  scene.add(tint);

  const card = new THREE.Group();
  scene.add(card);

  // The frame: the outer shape with the window cut out, extruded, in dark brushed metal.
  const outline = chamfered(W, H, OUTER_CUTS);
  outline.holes.push(chamfered(WINDOW.width, WINDOW.height, WINDOW_CUTS));
  const frameGeometry = keep(new THREE.ExtrudeGeometry(outline, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 2, curveSegments: 1 }));
  frameGeometry.translate(0, 0, -DEPTH / 2);
  const metal = keep(new THREE.MeshStandardMaterial({ color: 0x30353f, metalness: 0.92, roughness: 0.34, envMapIntensity: 1.2 }));
  card.add(new THREE.Mesh(frameGeometry, metal));

  // Raised plates, vents and screws on the face of the frame.
  const plateMetal = keep(new THREE.MeshStandardMaterial({ color: 0x4a515d, metalness: 0.95, roughness: 0.25, envMapIntensity: 1.3 }));
  const dark = keep(new THREE.MeshStandardMaterial({ color: 0x0b0d12, metalness: 0.4, roughness: 0.7 }));
  const face = DEPTH / 2 + 0.035;
  const box = (width: number, height: number, depth: number, x: number, y: number, material: THREE.Material, angle = 0) => {
    const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(width, height, depth)), material);
    mesh.position.set(x, y, face + depth / 2);
    mesh.rotation.z = angle;
    card.add(mesh);
  };
  box(1.9, 0.2, 0.07, -0.55, H / 2 - 0.18, plateMetal);
  box(1.8, 0.2, 0.07, -0.6, -H / 2 + 0.18, plateMetal);
  box(0.1, 2.6, 0.05, W / 2 - 0.13, 1.6, plateMetal);
  // A raised plate along the cut bottom left corner.
  box(0.62, 0.16, 0.08, -W / 2 + 0.52, -H / 2 + 0.52, plateMetal, -Math.PI / 4);
  for (let i = 0; i < 5; i += 1) box(0.14, 0.035, 0.02, W / 2 - 0.13, -0.9 - i * 0.12, dark);
  for (let i = 0; i < 4; i += 1) box(0.035, 0.12, 0.02, -2.1 + i * 0.09, H / 2 - 0.18, dark);
  const screw = keep(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16));
  for (const [x, y] of [[-W / 2 + 0.13, H / 2 - 0.5], [W / 2 - 0.13, -H / 2 + 1.3], [-W / 2 + 0.13, -H / 2 + 1.25], [W / 2 - 0.13, H / 2 - 1.25]]) {
    const mesh = new THREE.Mesh(screw, plateMetal);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, face + 0.015);
    card.add(mesh);
  }

  // The neon strips, each with a soft glow over it.
  const neon = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.light), toneMapped: false }));
  const glowMaterial = keep(new THREE.MeshBasicMaterial({
    map: keep(glowTexture()), color: new THREE.Color(colors.color), transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  const strip = (length: number, x: number, y: number, angle: number) => {
    const tube = new THREE.Mesh(keep(new THREE.BoxGeometry(length, 0.045, 0.03)), neon);
    tube.position.set(x, y, face + 0.015);
    tube.rotation.z = angle;
    card.add(tube);
    const glow = new THREE.Mesh(keep(new THREE.PlaneGeometry(length * 1.4, 0.5)), glowMaterial);
    glow.position.set(x, y, face + 0.04);
    glow.rotation.z = angle;
    glow.renderOrder = 6;
    card.add(glow);
  };
  strip(4.4, -W / 2 + 0.13, 0.4, Math.PI / 2);
  const cut = OUTER_CUTS[1];
  strip(cut * 1.05, W / 2 - cut / 2 - 0.1, H / 2 - cut / 2 - 0.1, -Math.PI / 4);
  strip(1.3, 1.2, -H / 2 + 0.12, 0);
  strip(0.9, 1.2, H / 2 - 0.1, 0);

  // The glass: a back pane with the hex grid, and a front pane with the text and the reflections.
  const paneGeometry = keep(new THREE.ShapeGeometry(chamfered(WINDOW.width, WINDOW.height, WINDOW_CUTS)));
  // ShapeGeometry has UVs in shape units, so they are mapped to 0..1 over the window.
  const uv = paneGeometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) / WINDOW.width + 0.5, uv.getY(i) / WINDOW.height + 0.5);
  const see = { transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false } as const;

  const glassTint = keep(new THREE.MeshBasicMaterial({ ...see, color: 0x9fb6ff, opacity: 0.07 }));
  const backPane = new THREE.Mesh(paneGeometry, keep(new THREE.MeshBasicMaterial({ ...see, map: keep(backTexture(text)) })));
  backPane.position.z = -0.11;
  const backTint = new THREE.Mesh(paneGeometry, glassTint);
  backTint.position.z = -0.112;

  // The person stands on the nameplate, below the number and the HP, and centered by their outline.
  const image = art.image as HTMLImageElement;
  const aspect = image.width / image.height;
  const figure = opaqueBounds(image);
  const floor = -WINDOW.height / 2 + PLATE;
  const room = { width: WINDOW.width * 0.94, height: WINDOW.height / 2 - 0.78 - floor };
  const planeHeight = Math.min(room.height / (figure.bottom - figure.top), room.width / ((figure.right - figure.left) * aspect));
  const planeWidth = planeHeight * aspect;
  const person = new THREE.Mesh(keep(new THREE.PlaneGeometry(planeWidth, planeHeight)), keep(new THREE.MeshBasicMaterial({ ...see, map: art })));
  person.position.set(-((figure.left + figure.right) / 2 - 0.5) * planeWidth, floor - 0.03 - planeHeight / 2 + figure.bottom * planeHeight, -0.02);
  const pad = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.6, 0.9)), keep(new THREE.MeshBasicMaterial({
    ...see, map: keep(padTexture(colors.light)), blending: THREE.AdditiveBlending, opacity: 0.8,
  })));
  pad.position.set(0, floor + 0.05, -0.06);

  const frontPane = new THREE.Mesh(paneGeometry, keep(new THREE.MeshBasicMaterial({ ...see, map: keep(frontTexture(text, number, setSize)) })));
  frontPane.position.z = 0.11;
  // Black glass that only adds its reflections: the environment slides across it as the card turns.
  // The opacity caps what it adds, so a light in the room glints on the glass but never whites out the person.
  const shine = new THREE.Mesh(paneGeometry, keep(new THREE.MeshPhysicalMaterial({
    color: 0x000000, roughness: 0.05, metalness: 0, envMapIntensity: 3.2,
    transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })));
  shine.position.z = 0.115;
  const frontTint = new THREE.Mesh(paneGeometry, glassTint);
  frontTint.position.z = 0.112;

  // The element badge sits on the frame at the bottom right, in front of the glass.
  const badge = new THREE.Group();
  const disc = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.44, 0.44, 0.1, 48)), plateMetal);
  disc.rotation.x = Math.PI / 2;
  badge.add(disc);
  const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.38, 0.026, 8, 64)), neon);
  ring.position.z = 0.06;
  badge.add(ring);
  const glyph = new THREE.Mesh(keep(new THREE.CircleGeometry(0.33, 48)), keep(new THREE.MeshBasicMaterial({ map: keep(badgeTexture(text)), toneMapped: false })));
  glyph.position.z = 0.056;
  badge.add(glyph);
  badge.position.set(W / 2 - 0.5, -H / 2 + 0.5, face + 0.08);
  card.add(badge);

  const back = [backTint, backPane];
  const middle = [pad, person];
  const front = [frontTint, frontPane, shine];
  for (const item of [...back, ...middle, ...front]) card.add(item);
  const order = (list: THREE.Object3D[], start: number) => list.forEach((item, index) => { item.renderOrder = start + index; });
  order(back, 1);
  order(middle, 3);
  order(front, 5);

  return {
    scene,
    card,
    front,
    back,
    dispose() {
      for (const item of disposable) item.dispose();
    },
  };
}

// Seen from behind, the front pane is the far one, so the panes swap their drawing order.
function setSide(built: Scene, camera: THREE.Camera) {
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(built.card.quaternion);
  const toCamera = camera.position.clone().sub(built.card.position).normalize();
  const facing = normal.dot(toCamera) >= 0;
  const [near, far] = facing ? [built.front, built.back] : [built.back, built.front];
  far.forEach((item, index) => { item.renderOrder = 1 + index; });
  near.forEach((item, index) => { item.renderOrder = 5 + index; });
}

// Places the camera so the card fits, with a margin, at any angle.
function aim(camera: THREE.PerspectiveCamera, aspect: number, margin: number) {
  camera.aspect = aspect;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, 0, Math.max((H / 2) * margin / tan, (W / 2) * margin / (tan * aspect)));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function makeRenderer(target: HTMLCanvasElement, alpha: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas: target, antialias: true, alpha, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function download(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// The best format MediaRecorder can record here: MP4 where it can, else WebM.
function videoFormat() {
  for (const type of ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return { type, extension: type.startsWith("video/mp4") ? "mp4" : "webm" };
  }
  return null;
}

export const GlassCard = forwardRef<GlassHandle, Props>(function GlassCard({ text, art, number, setSize, onFail }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ built: Scene; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; pose: { yaw: number; pitch: number } } | null>(null);

  useEffect(() => {
    const element = view.current;
    const container = host.current;
    if (!element || !container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = makeRenderer(element, true);
    } catch {
      onFail();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    let built: Scene | null = null;
    let frame = 0;
    let stopped = false;
    const pose = { yaw: -0.35, pitch: 0.06 };
    const motion = { dragging: false, x: 0, y: 0, spin: 0, last: 0 };

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height, false);
      aim(camera, width / height, 1.1);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const loop = (time: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(loop);
      if (!built) return;
      if (!motion.dragging) {
        pose.yaw += motion.spin;
        motion.spin *= 0.94;
        // After a short rest the card sways around the side it shows.
        if (time - motion.last > 2500 && Math.abs(motion.spin) < 0.002) {
          const home = Math.round(pose.yaw / (Math.PI * 2)) * Math.PI * 2;
          const target = home + Math.sin(time / 1800) * 0.38;
          pose.yaw += (target - pose.yaw) * 0.025;
          pose.pitch += (Math.sin(time / 2600) * 0.07 - pose.pitch) * 0.025;
        }
      }
      built.card.rotation.set(pose.pitch, pose.yaw, 0);
      setSide(built, camera);
      renderer.render(built.scene, camera);
    };
    frame = requestAnimationFrame(loop);

    const loader = new THREE.TextureLoader();
    loader.load(art, (map) => {
      if (stopped) return map.dispose();
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      built = buildScene(text, map, number, setSize, renderer);
      state.current = { built, renderer, camera, pose };
    }, undefined, () => onFail());

    const down = (event: PointerEvent) => {
      motion.dragging = true;
      motion.x = event.clientX;
      motion.y = event.clientY;
      motion.spin = 0;
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!motion.dragging) return;
      const dx = event.clientX - motion.x;
      const dy = event.clientY - motion.y;
      motion.x = event.clientX;
      motion.y = event.clientY;
      pose.yaw += dx * 0.011;
      pose.pitch = THREE.MathUtils.clamp(pose.pitch + dy * 0.006, -0.45, 0.45);
      motion.spin = dx * 0.011;
      motion.last = performance.now();
    };
    const up = () => {
      motion.dragging = false;
      motion.last = performance.now();
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      built?.dispose();
      state.current = null;
      renderer.dispose();
    };
  }, [text, art, number, setSize, onFail]);

  // Each export draws the same scene with its own renderer, at its own size, on a dark backdrop.
  useImperativeHandle(ref, () => {
    const offscreen = (size: { width: number; height: number }) => {
      const current = state.current;
      if (!current) throw new Error("The card is still loading.");
      const target = document.createElement("canvas");
      target.width = size.width;
      target.height = size.height;
      // A canvas outside the page may not deliver video frames, so it sits out of sight on the page.
      Object.assign(target.style, { position: "fixed", left: "-10000px", top: "0", width: "10px", height: "10px" });
      document.body.append(target);
      const renderer = makeRenderer(target, false);
      renderer.setSize(size.width, size.height, false);
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      const backdrop = backdropTexture(text, size.width, size.height);
      const light = environment(renderer);
      const draw = (yaw: number, pitch: number) => {
        const scene = current.built.scene;
        const previous = { background: scene.background, environment: scene.environment, rotation: current.built.card.rotation.clone() };
        scene.background = backdrop;
        scene.environment = light;
        current.built.card.rotation.set(pitch, yaw, 0);
        setSide(current.built, camera);
        renderer.render(scene, camera);
        scene.background = previous.background;
        scene.environment = previous.environment;
        current.built.card.rotation.copy(previous.rotation);
      };
      const close = () => {
        backdrop.dispose();
        light.dispose();
        renderer.dispose();
        target.remove();
      };
      return { target, camera, draw, close };
    };

    return {
      async png(name) {
        const { target, camera, draw, close } = offscreen(PNG_SIZE);
        try {
          aim(camera, PNG_SIZE.width / PNG_SIZE.height, 1.16);
          draw(-0.3, 0.07);
          const blob = await new Promise<Blob | null>((resolve) => target.toBlob(resolve, "image/png"));
          if (!blob) throw new Error("This browser could not make the PNG.");
          download(blob, `${slug(name)}-glass-card.png`);
        } finally {
          close();
        }
      },

      async video(name) {
        const { target, camera, draw, close } = offscreen(VIDEO_SIZE);
        // One slow turn all the way round, starting and ending at the same three-quarter view.
        const frames = VIDEO_SECONDS * VIDEO_FPS;
        const turn = (index: number) => {
          const t = index / frames;
          draw(-0.3 + ease(t) * Math.PI * 2, 0.05 + Math.sin(t * Math.PI * 2) * 0.06);
        };
        try {
          aim(camera, VIDEO_SIZE.width / VIDEO_SIZE.height, 1.28);
          // WebCodecs encodes each frame at its own timestamp, as fast as the GPU draws, so the video
          // never drops frames. Browsers without an H.264 encoder record the canvas in real time instead.
          const media = await import("mediabunny");
          if (await media.canEncodeVideo("avc", { ...VIDEO_SIZE })) {
            const output = new media.Output({ format: new media.Mp4OutputFormat({ fastStart: "in-memory" }), target: new media.BufferTarget() });
            const source = new media.CanvasSource(target, { codec: "avc", bitrate: media.QUALITY_HIGH, keyFrameInterval: 2 });
            output.addVideoTrack(source, { frameRate: VIDEO_FPS });
            await output.start();
            for (let index = 0; index < frames; index += 1) {
              turn(index);
              await source.add(index / VIDEO_FPS, 1 / VIDEO_FPS);
            }
            await output.finalize();
            if (!output.target.buffer) throw new Error("This browser could not make the video.");
            download(new Blob([output.target.buffer], { type: "video/mp4" }), `${slug(name)}-glass-card.mp4`);
            return;
          }
          const format = videoFormat();
          if (!format) throw new Error("This browser cannot record video.");
          // The stream takes a frame only when asked, so every drawn frame is in the video.
          const stream = target.captureStream(0);
          const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
          const recorder = new MediaRecorder(stream, { mimeType: format.type, videoBitsPerSecond: 12_000_000 });
          const chunks: Blob[] = [];
          recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
          const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
          recorder.start();
          for (let index = 0; index < frames; index += 1) {
            turn(index);
            track.requestFrame();
            await new Promise((resolve) => setTimeout(resolve, 1000 / VIDEO_FPS));
          }
          recorder.stop();
          await done;
          stream.getTracks().forEach((item) => item.stop());
          download(new Blob(chunks, { type: format.type.split(";")[0] }), `${slug(name)}-glass-card.${format.extension}`);
        } finally {
          close();
        }
      },
    };
  }, [text]);

  return (
    <div ref={host} className="glass-stage" style={{ ["--glow" as string]: ELEMENTS[text.element].color }}>
      <canvas ref={view} className="glass-canvas" aria-label={`${text.name}, a 3D glass card. Drag to turn it.`} role="img" />
    </div>
  );
});
