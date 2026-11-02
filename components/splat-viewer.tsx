"use client";

// The interactive Gaussian splat: three.js with Spark renders the real .sog file from TripoSplat.
// Drag to rotate, scroll or pinch to zoom. The hero move eases the camera from the front to a
// three-quarter view, where a one-image reconstruction looks its best.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type SplatViewerHandle = { reset(): void; hero(): void; face?(): void };

type Props = {
  url: string;
  autoRotate: boolean;
  onReady?: () => void;
};

// TripoSplat faces its characters down +X in this frame, so the front camera sits on +X.
const FRONT_AZIMUTH = Math.PI / 2;
const HERO_TURN = (35 * Math.PI) / 180;
const HERO_MS = 4200;
const FOV = 32;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const SplatViewer = forwardRef<SplatViewerHandle, Props>(function SplatViewer({ url, autoRotate, onReady }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset(): void; hero(): void; setAutoRotate(on: boolean): void } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const latest = useRef({ autoRotate, onReady });
  latest.current = { autoRotate, onReady };

  useImperativeHandle(ref, () => ({ reset: () => api.current?.reset(), hero: () => api.current?.hero() }), []);

  useEffect(() => {
    api.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup = () => {};
    setState("loading");

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      element.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 200);
      scene.add(new SparkRenderer({ renderer }));

      const splat = new SplatMesh({ url });
      // The file is Y-down (the usual Gaussian splat convention). Turn it upright.
      splat.quaternion.set(1, 0, 0, 0);
      const pivot = new THREE.Group();
      pivot.add(splat);
      scene.add(pivot);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.rotateSpeed = 0.7;
      controls.autoRotateSpeed = 1.6;

      const resize = () => {
        const { width, height } = element.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();

      let home = { distance: 3, height: 0 };
      let tween: { from: number; to: number; fromDistance: number; toDistance: number; start: number; ms: number } | null = null;
      const spherical = new THREE.Spherical();

      const place = (azimuth: number, distance: number) => {
        spherical.set(distance, Math.PI / 2 - 0.08, azimuth);
        camera.position.setFromSpherical(spherical).add(controls.target);
        camera.lookAt(controls.target);
      };

      const turnTo = (azimuth: number, distance: number, ms: number) => {
        spherical.setFromVector3(camera.position.clone().sub(controls.target));
        let from = spherical.theta;
        // Take the short way round.
        while (from - azimuth > Math.PI) from -= Math.PI * 2;
        while (azimuth - from > Math.PI) from += Math.PI * 2;
        tween = { from, to: azimuth, fromDistance: spherical.radius, toDistance: distance, start: performance.now(), ms };
      };

      controls.addEventListener("start", () => { tween = null; });

      api.current = {
        reset: () => turnTo(FRONT_AZIMUTH, home.distance, 900),
        hero: () => turnTo(FRONT_AZIMUTH + HERO_TURN, home.distance, HERO_MS),
        setAutoRotate: (on) => { controls.autoRotate = on; },
      };

      let frame = 0;
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (tween) {
          const t = Math.min(1, (performance.now() - tween.start) / tween.ms);
          const k = ease(t);
          place(tween.from + (tween.to - tween.from) * k, tween.fromDistance + (tween.toDistance - tween.fromDistance) * k);
          if (t >= 1) tween = null;
        }
        controls.update();
        renderer.render(scene, camera);
      };

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        splat.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        api.current = null;
      };

      try {
        await splat.initialized;
      } catch {
        if (!disposed) setState("failed");
        return;
      }
      if (disposed) return;

      // Center the character on the orbit pivot and frame its full height.
      splat.updateMatrixWorld(true);
      const box = splat.getBoundingBox(true).applyMatrix4(splat.matrixWorld);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      splat.position.sub(center);
      const radius = Math.max(size.y / 2, Math.max(size.x, size.z) / 2 / camera.aspect);
      home = { distance: (radius / Math.tan((FOV * Math.PI) / 360)) * 1.32, height: 0 };
      controls.minDistance = home.distance * 0.35;
      controls.maxDistance = home.distance * 2.5;
      place(FRONT_AZIMUTH, home.distance * 1.08);
      controls.autoRotate = latest.current.autoRotate;
      setState("ready");
      latest.current.onReady?.();
      loop();
    })().catch(() => {
      if (!disposed) setState("failed");
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [url]);

  return (
    <div className="viewer" data-state={state}>
      <div className="viewer-canvas" ref={host} />
      {state === "loading" ? <div className="viewer-note"><span className="spinner" /> Loading the splat…</div> : null}
      {state === "failed" ? <div className="viewer-note">This browser could not show the splat. Download it from Files instead.</div> : null}
    </div>
  );
});
