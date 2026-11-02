#!/usr/bin/env python3
"""Character Forge adapter for the released ModelSheetTo3D pipeline.

No model implementation is vendored. Run in the CUDA environment described in README.md.
An isolated workspace is created for each bundle; success is only emitted after all stages.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

REVISION = "569363513b6f847b2363ea71b6bcdbff2bcb3c3e"
DRAWINGS_REVISION = "2349aee4daf7cb01d8de645b0bbb4f4392fd1395"
FORMAT = "character-forge-modelsheet-v1"
LIMIT = 250 * 1024 * 1024
INPUTS = {"base.glb", *(f"views/{i:03d}.png" for i in range(4))}


def read_bundle(bundle: Path):
    """Validate before writing anything, including hashes and archive paths."""
    with zipfile.ZipFile(bundle) as archive:
        names = archive.namelist()
        if len(set(names)) != len(names) or set(names) != INPUTS | {"manifest.json", "run.py", "README.md"}:
            raise ValueError("Unexpected or duplicate bundle entries")
        if sum(f.file_size for f in archive.infolist()) > LIMIT:
            raise ValueError("Expanded input bundle exceeds 250 MB")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest["format"] != FORMAT or manifest["revision"] != REVISION:
            raise ValueError("Unsupported bundle version or ModelSheetTo3D revision")
        import uuid
        uuid.UUID(manifest["job"])
        files = {name: archive.read(name) for name in INPUTS}
        if set(manifest["inputs"]) != INPUTS:
            raise ValueError("Incomplete input hashes")
        for name, data in files.items():
            if hashlib.sha256(data).hexdigest() != manifest["inputs"][name]:
                raise ValueError(f"Input checksum mismatch: {name}")
        if manifest["baseSha256"] != manifest["inputs"]["base.glb"]:
            raise ValueError("Base mesh checksum mismatch")
        angles = manifest["settings"]["angles"]
        if angles["front"] != 0 or any(angles[k] <= 0 for k in ("three_quarter", "side", "back")):
            raise ValueError("Front must be the first camera for upstream face decals")
        face = manifest["settings"]["face"]
        if len(face) < 3 or any(len(p) != 2 or any(not 0 <= n <= 1 for n in p) for p in face):
            raise ValueError("Invalid face polygon")
        return manifest, files


def verify_checkout(path: Path, revision: str):
    actual = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    if actual != revision:
        raise RuntimeError(f"Use the pinned checkout {revision} at {path}; found {actual}")
    if subprocess.check_output(["git", "-C", str(path), "status", "--porcelain", "--untracked-files=no"], text=True).strip():
        raise RuntimeError(f"Checkout has modified tracked files: {path}")


def preflight(args):
    verify_checkout(args.repo, REVISION)
    verify_checkout(args.drawings, DRAWINGS_REVISION)
    if not (args.repo / "APAP/src/geometry/poisson_system.py").exists():
        raise RuntimeError("Initialize ModelSheetTo3D's APAP submodule")
    if not args.checkpoint.is_file():
        raise RuntimeError("Missing Informative Drawings anime_style/netG_A_latest.pth checkpoint")
    if not shutil.which(str(args.blender)):
        raise RuntimeError("Blender 4.3.2 is required; pass --blender /path/to/blender")
    for module in ("torch", "torchvision", "numpy", "PIL", "cv2", "trimesh", "rembg", "nvdiffrast.torch", "pytorch3d", "igl", "cholespy", "jaxtyping", "typeguard", "pymeshlab", "pyrender", "hdbscan", "gco", "rtree"):
        __import__(module)
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU unavailable. This pipeline cannot run on Apple Metal or CPU.")
    print(f"CUDA ready: {torch.cuda.get_device_name(0)}", flush=True)


def export_base(glb: Path, target: Path, yaw: float):
    """Keep the complete UV mesh and base color; no implicit decimation."""
    import numpy as np
    import trimesh
    scene = trimesh.load_scene(glb, process=False)
    meshes = list(scene.dump())  # applies node transforms, including glTF's world orientation
    if len(meshes) != 1 or not isinstance(meshes[0], trimesh.Trimesh):
        raise RuntimeError("Expected one textured TRELLIS.2 mesh; merge multi-part inputs before refinement")
    mesh = meshes[0]
    if mesh.visual.kind != "texture" or mesh.visual.uv is None:
        raise RuntimeError("The base mesh needs UVs and a base-color texture")
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.deg2rad(yaw), [0, 1, 0]))
    material = mesh.visual.material
    if hasattr(material, "to_simple"):
        material = material.to_simple()
    if getattr(material, "image", None) is None:
        raise RuntimeError("No base-color image found in the GLB")
    target.mkdir(parents=True, exist_ok=True)
    material.image.convert("RGB").save(target / "material_0.png")
    # Upstream requires these exact names, and only reads the base color.
    mesh.visual.material = trimesh.visual.material.SimpleMaterial(image=material.image, name="material_0")
    obj = trimesh.exchange.obj.export_obj(mesh, include_texture=True, write_texture=False)
    if not isinstance(obj, str):
        raise RuntimeError("OBJ exporter returned an unexpected format")
    if "\nvt " not in obj:
        raise RuntimeError("OBJ conversion lost the base UV coordinates")
    # Keep exported UVs and replace the generated material references with upstream's names.
    obj = "mtllib 001.mtl\nusemtl material_0\n" + "\n".join(line for line in obj.splitlines() if not line.startswith(("mtllib ", "usemtl ")))
    (target / "001.obj").write_text(obj)
    (target / "001.mtl").write_text("newmtl material_0\nKd 1 1 1\nKa 0 0 0\nKs 0 0 0\nmap_Kd material_0.png\n")
    print(f"Preserved {len(mesh.faces):,} triangles and base-color UVs", flush=True)


def prepare_images(files, manifest, data: Path, drawings: Path, checkpoint: Path):
    import importlib.util
    import numpy as np
    from PIL import Image, ImageDraw
    import torch
    from torchvision.transforms import functional as tf, InterpolationMode
    from rembg import new_session, remove

    (data / "drawing_ori").mkdir(parents=True)
    (data / "line_ori").mkdir()
    (data / "decal").mkdir()
    # Import under a unique name: upstream ModelSheetTo3D also has a generic utils module.
    spec = importlib.util.spec_from_file_location("forge_informative_model", drawings / "model.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    net = module.Generator(3, 1, 3).cuda().eval()
    net.load_state_dict(torch.load(checkpoint, map_location="cuda", weights_only=True))
    session = new_session("birefnet-general", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    import io
    for i in range(4):
        image = Image.open(io.BytesIO(files[f"views/{i:03d}.png"])).convert("RGBA")
        # Segment without changing framing: the face polygon remains in original image coordinates.
        rgba = remove(image, session=session)
        alpha = np.asarray(rgba.getchannel("A"))
        if np.count_nonzero(alpha > 127) < alpha.size * .01:
            raise RuntimeError(f"Empty foreground in view {i}; inspect the segmented inputs")
        rgba.save(data / "drawing_ori" / f"{i:03d}.png")
        white = Image.new("RGB", rgba.size, "white")
        white.paste(rgba, mask=rgba.getchannel("A"))
        # Match upstream gen_line_images.py: shortest edge 256, edge pad 32, align to 4.
        resized = tf.resize(white, 256, interpolation=InterpolationMode.BICUBIC)
        resized = tf.pad(resized, [32, 32, 32, 32], padding_mode="edge")
        w, h = resized.size
        padded = tf.pad(resized, [0, 0, (-w) % 4, (-h) % 4], padding_mode="edge")
        with torch.no_grad():
            line = net(tf.to_tensor(padded).unsqueeze(0).cuda())[0, 0, :h, :w].clamp(0, 1).cpu().numpy()
        Image.fromarray((line * 255).astype("uint8")).save(data / "line_ori" / f"{i:03d}.png")
        if i == 0:
            mask = Image.new("L", rgba.size)
            ImageDraw.Draw(mask).polygon([(round(x * (rgba.width - 1)), round(y * (rgba.height - 1))) for x, y in manifest["settings"]["face"]], fill=255)
            mask.save(data / "decal/mask.png")
    angles = manifest["settings"]["angles"]
    (data / "view.txt").write_text("\n".join(str(angles[k]) for k in ("front", "three_quarter", "side", "back")) + "\n")
    del net, session
    torch.cuda.empty_cache()


def export_result(result: Path, destination: Path, manifest):
    import numpy as np
    import trimesh
    mesh_path = result / "colored_mesh/001_refine.ply"
    decal_path = result / "decal/decal.ply"
    preview = result / "stylized_rendering/000.png"
    if not all(p.is_file() for p in (mesh_path, decal_path, preview)):
        raise RuntimeError("ModelSheetTo3D did not produce all expected outputs")
    mesh = trimesh.load(mesh_path, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise RuntimeError("Invalid refined geometry")
    # PLY stores per-face colors. Split vertices to preserve sharp color boundaries in glTF.
    vertices = mesh.vertices[mesh.faces].reshape(-1, 3)
    colors = np.repeat(mesh.visual.face_colors, 3, axis=0)
    flat = trimesh.Trimesh(vertices=vertices, faces=np.arange(len(vertices)).reshape(-1, 3), vertex_colors=colors, process=False)
    decal = trimesh.load(decal_path, process=False)
    if not isinstance(decal, trimesh.points.PointCloud) or not len(decal.vertices) or not np.isfinite(decal.vertices).all():
        raise RuntimeError("Invalid face decal point cloud")
    scene = trimesh.Scene()
    scene.add_geometry(flat, node_name="refined_geometry")
    scene.add_geometry(decal, node_name="face_decal_points")

    def unlit(tree):
        # Flat drawing colors should not be relit like the original PBR material.
        used = tree.setdefault("extensionsUsed", [])
        if "KHR_materials_unlit" not in used:
            used.append("KHR_materials_unlit")
        # Trimesh emits vertex colors without any material. Explicitly create one:
        # merely adding extensionsUsed would leave the default lit glTF material.
        tree["materials"] = [{"name": "drawing_colors", "doubleSided": True,
            "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1},
            "extensions": {"KHR_materials_unlit": {}}}]
        for mesh in tree["meshes"]:
            for primitive in mesh["primitives"]:
                primitive["material"] = 0

    glb = trimesh.exchange.gltf.export_glb(scene, tree_postprocessor=unlit)
    metadata = {"status": "complete", "manifest": manifest, "triangles": len(flat.faces), "decalPoints": len(decal.vertices), "appearance": "flat-colored mesh with a POINTS decal layer; view-dependent stylization is preview-only"}
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(".tmp")
    with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("result.json", json.dumps(metadata, indent=2))
        archive.writestr("refined.glb", glb)
        archive.write(mesh_path, "refined.ply")
        archive.write(decal_path, "decal.ply")
        archive.write(preview, "preview.png")
    with zipfile.ZipFile(temp) as archive:
        expanded = sum(info.file_size for info in archive.infolist())
    if temp.stat().st_size > LIMIT or expanded > LIMIT:
        temp.unlink()
        raise RuntimeError("Result exceeds the app's 250 MB import limit")
    temp.replace(destination)
    print(f"Result ready: {destination}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path, nargs="?")
    parser.add_argument("--repo", type=Path, required=True, help="Pinned ModelSheetTo3D checkout with APAP submodule")
    parser.add_argument("--drawings", type=Path, required=True, help="Pinned Informative Drawings checkout")
    parser.add_argument("--checkpoint", type=Path, required=True, help="anime_style/netG_A_latest.pth")
    parser.add_argument("--blender", type=Path, default=Path("blender"))
    parser.add_argument("--work", type=Path, default=Path("modelsheet-runs"))
    parser.add_argument("--output", type=Path, default=Path("modelsheet-result.zip"))
    parser.add_argument("--check", action="store_true", help="Check dependencies and CUDA without running a job")
    args = parser.parse_args()
    for key in ("repo", "drawings", "checkpoint", "work", "output"):
        setattr(args, key, getattr(args, key).resolve())
    preflight(args)
    if args.check:
        return
    if not args.bundle:
        parser.error("Provide the input bundle or --check")
    manifest, files = read_bundle(args.bundle)
    work = args.work / manifest["job"]
    # A partial run is deliberately not reused; upstream stage_done checks are too coarse.
    work.mkdir(parents=True, exist_ok=False)
    data = work / "data/ModelSheets/001"
    data.mkdir(parents=True)
    (work / "base.glb").write_bytes(files["base.glb"])
    export_base(work / "base.glb", data / "TRELLIS", manifest["settings"]["meshYaw"])
    prepare_images(files, manifest, data, args.drawings, args.checkpoint)
    sys.path.insert(0, str(args.repo))
    sys.path.insert(0, str(args.repo / "src"))
    os.environ.setdefault("PYOPENGL_PLATFORM", "egl")
    from run_all import run_pipeline
    # No new TRELLIS or Gemini generation: use the existing base and original Qwen views.
    success = run_pipeline(dataset="ModelSheets", data_root=work / "data", result_root=work / "result", start_stage=None, num=1, res=1024, blender_exe=args.blender, process_mesh=False, skip_existing=False, seed=manifest["seed"])
    if not success:
        raise RuntimeError("ModelSheetTo3D pipeline reported failure")
    export_result(work / "result/ModelSheets/001", args.output, manifest)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Refinement failed: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
