"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SplatViewerHandle } from "./splat-viewer";

type Props = { url: string; autoRotate: boolean; wireframe: boolean; part?: "head" | "full"; onReady?: () => void };

export const MeshViewer = forwardRef<SplatViewerHandle, Props>(function MeshViewer({ url, autoRotate, wireframe, part = "full", onReady }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset(): void; hero(): void; face(): void; rotate(on: boolean): void; wireframe(on: boolean): void } | null>(null);
  const latest = useRef({ autoRotate, wireframe, part, onReady });
  latest.current = { autoRotate, wireframe, part, onReady };
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useImperativeHandle(ref, () => ({ reset: () => api.current?.reset(), hero: () => api.current?.hero(), face: () => api.current?.face() }), []);
  useEffect(() => { api.current?.rotate(autoRotate); }, [autoRotate]);
  useEffect(() => { api.current?.wireframe(wireframe); }, [wireframe]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup = () => {};
    setState("loading");
    (async () => {
      const THREE = await import("three");
      const [{ OrbitControls }, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
        import("three/examples/jsm/controls/OrbitControls.js"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
      ]);
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setClearColor(0, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const wireMaterial = new THREE.MeshStandardMaterial({ color: 0x7ce7ff, roughness: 0.85, metalness: 0, wireframe: true });
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room, 0.04);
      room.dispose();
      pmrem.dispose();
      scene.environment = environment.texture;
      const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.autoRotate = latest.current.autoRotate;
      controls.autoRotateSpeed = 1.6;
      let distance = 3;
      let homeDistance = 3;
      let radius = 1;
      let model: import("three").Group | undefined;
      let frame = 0;
      let tween: { from: number; to: number; start: number; duration: number } | null = null;
      const place = (angle: number) => {
        camera.position.set(Math.sin(angle) * distance, distance * 0.08, Math.cos(angle) * distance).add(controls.target);
        camera.lookAt(controls.target);
      };
      const turn = (angle: number, duration: number) => {
        const from = Math.atan2(camera.position.x, camera.position.z);
        tween = { from, to: from + Math.atan2(Math.sin(angle - from), Math.cos(angle - from)), start: performance.now(), duration };
      };
      controls.addEventListener("start", () => { tween = null; });
      const resize = () => {
        const { width, height } = element.getBoundingClientRect();
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        homeDistance = radius / Math.sin(THREE.MathUtils.degToRad(16)) * Math.max(1, 1 / camera.aspect) * 1.15;
        distance = homeDistance;
        controls.minDistance = distance * 0.3;
        controls.maxDistance = distance * 3;
        if (model) place(Math.atan2(camera.position.x, camera.position.z));
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();
      const disposeModel = (object: import("three").Group) => {
        const textures = new Set<import("three").Texture>();
        object.traverse((child) => {
          if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points)) return;
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
            material.dispose();
          }
        });
        textures.forEach((texture) => texture.dispose());
      };
      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        if (model) disposeModel(model);
        wireMaterial.dispose();
        environment.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        api.current = null;
      };
      const gltf = await new GLTFLoader().loadAsync(url);
      if (disposed) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      if (bounds.isEmpty()) throw new Error("The GLB has no visible geometry.");
      model.position.sub(bounds.getCenter(new THREE.Vector3()));
      radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
      model.traverse((child) => {
        if (child instanceof THREE.Points && child.material instanceof THREE.PointsMaterial) {
          child.material.size = radius * 0.0015;
          child.material.sizeAttenuation = true;
        }
      });
      scene.add(model);
      resize();
      place(0);
      api.current = {
        reset: () => { controls.target.set(0, 0, 0); distance = homeDistance; controls.minDistance = homeDistance * 0.3; turn(0, 900); },
        hero: () => turn(35 * Math.PI / 180, 4200),
        face: () => {
          tween = null;
          controls.autoRotate = false;
          const height = bounds.max.y - bounds.min.y;
          const headOnly = latest.current.part === "head";
          controls.target.set(0, height * (headOnly ? 0.15 : 0.4), 0);
          distance = height * (headOnly ? 1.4 : 0.48);
          controls.minDistance = height * 0.08;
          place(0);
          controls.update();
        },
        rotate: (on) => { controls.autoRotate = on; },
        wireframe: (on) => {
          scene.overrideMaterial = on ? wireMaterial : null;
          // Decals are points, not triangles; show the underlying mesh in wireframe mode.
          model?.traverse((child) => { if (child instanceof THREE.Points) child.visible = !on; });
        },
      };
      api.current.wireframe(latest.current.wireframe);
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (tween) {
          const t = Math.min(1, (performance.now() - tween.start) / tween.duration);
          const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
          place(tween.from + (tween.to - tween.from) * k);
          if (t === 1) tween = null;
        }
        controls.update();
        renderer.render(scene, camera);
      };
      setState("ready");
      latest.current.onReady?.();
      loop();
    })().catch(() => {
      cleanup();
      if (!disposed) setState("failed");
    });
    return () => { disposed = true; cleanup(); };
  }, [url]);

  return <div className="viewer" data-state={state}>
    <div className="viewer-canvas" ref={host} />
    {state === "loading" ? <div className="viewer-note"><span className="spinner" /> Loading the textured mesh…</div> : null}
    {state === "failed" ? <div className="viewer-note">This browser could not show the mesh. Download the GLB from Files.</div> : null}
  </div>;
});
