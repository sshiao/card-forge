"""Build-time setup for the dedicated Linux/NVIDIA Comfy deployment."""
from pathlib import Path
import hashlib
import os
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
VENDOR.mkdir(exist_ok=True)


def checkout(name, url, revision, submodules=False):
    path = VENDOR / name
    if not path.exists():
        subprocess.run(["git", "clone", "--no-checkout", url, str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "checkout", revision], check=True)
    if submodules:
        subprocess.run(["git", "-C", str(path), "submodule", "update", "--init", "--recursive"], check=True)


checkout("ModelSheetTo3D", "https://github.com/hjyoon02/ModelSheetTo3D.git", "569363513b6f847b2363ea71b6bcdbff2bcb3c3e", True)
checkout("informative-drawings", "https://github.com/carolineec/informative-drawings.git", "2349aee4daf7cb01d8de645b0bbb4f4392fd1395")

env = {**os.environ, "FORCE_CUDA": "1", "MAX_JOBS": "2", "TORCH_CUDA_ARCH_LIST": "8.0;8.6;8.9;9.0;12.0"}
for requirement in ["git+https://github.com/NVlabs/nvdiffrast.git@v0.3.3", "git+https://github.com/facebookresearch/pytorch3d.git@v0.7.8"]:
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-build-isolation", requirement], env=env, check=True)

models = ROOT / "models"
models.mkdir(exist_ok=True)
# From the authors' own Informative Drawings demo (style 1), pinned by LFS digest.
checkpoint = models / "line-model.pth"
if not checkpoint.exists():
    urllib.request.urlretrieve("https://huggingface.co/spaces/carolineec/informativedrawings/resolve/main/model.pth", checkpoint)
if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != "c686ced2a666b4850b4bb6ccf0748031c3eda9f822de73a34b8979970d90f0c6":
    raise RuntimeError("Informative Drawings checkpoint digest mismatch")

blender = VENDOR / "blender-4.3.2-linux-x64"
if not blender.exists():
    archive = VENDOR / "blender.tar.xz"
    urllib.request.urlretrieve("https://download.blender.org/release/Blender4.3/blender-4.3.2-linux-x64.tar.xz", archive)
    with tarfile.open(archive) as tar:
        tar.extractall(VENDOR, filter="data")
    archive.unlink()

# Keep foreground weights inside the pack so they survive into the release image.
os.environ["U2NET_HOME"] = str(models)
from rembg import new_session
new_session("birefnet-general", providers=["CPUExecutionProvider"])
print("ModelSheetTo3D research sources, extensions, weights and Blender installed")
