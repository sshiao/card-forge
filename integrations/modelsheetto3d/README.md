# ModelSheetTo3D refinement for Character Forge

This adapter consumes the app's existing TRELLIS.2 GLB and four individual Qwen views. It calls the **released ModelSheetTo3D pipeline**, not an approximation implemented in JavaScript. It does not rerun TRELLIS or use Gemini. GPU execution has not been verified in this workspace: this Mac has no CUDA, and the current Comfy Cloud catalog has no ModelSheetTo3D node. A configured external CUDA host is required.

## Prepare in the app

Open a finished full-body character and click **Refine with ModelSheetTo3D**. Outline the face details and check each camera yaw. Download the input ZIP. Each preparation creates a new job ID and records the exact base mesh and view hashes. Preparing again replaces the pending job; results from older bundles will be rejected.

The exported ZIP includes `manifest.json`, `base.glb`, four `views/*.png`, this guide and `run.py`. No credentials are included. Transfer it to your GPU host and extract only `run.py` and this guide initially. The runner validates and reads the inputs directly from the ZIP.

## GPU environment

Upstream tested an RTX 4090, PyTorch 2.6 / CUDA 12.6, and Blender 4.3.2. A million-face base can require substantial memory for the differentiable Poisson solver. This adapter preserves all triangles; it does not silently decimate the input. Start with a single character, and inspect GPU memory and logs before batching.

Use Linux with NVIDIA drivers and CUDA development tools (`nvcc` is needed to build extensions). For example, start from `pytorch/pytorch:2.6.0-cuda12.6-cudnn9-devel`, using an isolated Python 3.11 environment. Install the system libraries required by OpenGL/EGL, OpenCV, MeshLab, and Blender (Ubuntu packages include `git build-essential libgl1 libegl1 libglib2.0-0 libgomp1 libxrender1 libxi6 libxkbcommon0 libsm6 libxext6`). Install Blender 4.3.2 separately and retain its executable path.

Clone the exact upstream sources:

```sh
git clone https://github.com/hjyoon02/ModelSheetTo3D.git
git -C ModelSheetTo3D checkout 569363513b6f847b2363ea71b6bcdbff2bcb3c3e
git -C ModelSheetTo3D submodule update --init --recursive
git clone https://github.com/carolineec/informative-drawings.git
git -C informative-drawings checkout 2349aee4daf7cb01d8de645b0bbb4f4392fd1395
```

Install PyTorch 2.6.0 and torchvision 0.21.0 with CUDA 12.6 using the [PyTorch wheel index](https://download.pytorch.org/whl/cu126), then the upstream Python dependencies. The following also includes dependencies used by APAP that are absent from ModelSheetTo3D's environment file:

```sh
python -m pip install ninja 'numpy<2' scipy matplotlib pillow tqdm scikit-image scikit-learn opencv-python-headless trimesh imageio python-dotenv libigl hdbscan gco-wrapper pymeshlab pyrender 'rembg[gpu]' cholespy jaxtyping 'typeguard<3' rtree
python -m pip install --no-build-isolation 'git+https://github.com/NVlabs/nvdiffrast.git@v0.3.3'
python -m pip install --no-build-isolation 'git+https://github.com/facebookresearch/pytorch3d.git@v0.7.8'
```

Download the [Informative Drawings pretrained checkpoint](https://github.com/carolineec/informative-drawings#testing) from its authors and extract `anime_style/netG_A_latest.pth`. The runner uses this learned line extractor. BiRefNet foreground segmentation downloads its open checkpoint through `rembg` on first use; cache it on the GPU host for subsequent jobs. Check the licenses of upstream code and weights for your intended distribution; they are not included in this repository or bundle.

## Run

Use absolute paths for the three repositories/checkpoints/Blender arguments. First check the environment:

```sh
python run.py --check \
  --repo /workspace/ModelSheetTo3D \
  --drawings /workspace/informative-drawings \
  --checkpoint /workspace/checkpoints/anime_style/netG_A_latest.pth \
  --blender /workspace/blender-4.3.2-linux-x64/blender
```

Then run the downloaded bundle, replacing `modelsheet-CHARACTER.zip` with its actual filename:

```sh
python run.py modelsheet-CHARACTER.zip \
  --repo /workspace/ModelSheetTo3D \
  --drawings /workspace/informative-drawings \
  --checkpoint /workspace/checkpoints/anime_style/netG_A_latest.pth \
  --blender /workspace/blender-4.3.2-linux-x64/blender \
  --work /workspace/modelsheet-runs \
  --output /workspace/modelsheet-result.zip
```

A unique workspace is created under `--work/<job-id>` with segmented inputs, line drawings, the original-resolution face mask, `view.txt`, a textured OBJ base, and upstream intermediate results/logs. For a failed run, inspect that workspace; choose a different `--work` directory to retry the same bundle. Partial stages are never silently reused. The upstream CLI prints `Success: False` without a nonzero exit, so this adapter calls `run_pipeline` directly and checks its returned success flag.

The adapter passes `process_mesh=False` to preserve the base's UVs and avoid upstream material-renaming issues. Base geometry must be one textured mesh; our native TRELLIS.2 exports meet this requirement. If the model faces away from the front view, adjust **Base mesh rotation about Y** in the app and prepare a fresh bundle before rerunning. The runner preserves input framing during segmentation and uses the annotation in original image coordinates.

## Import and inspect

Return to the same character, reopen the refinement dialog, and import `modelsheet-result.zip`. The app verifies job identity, full preparation metadata, the unchanged base mesh, file types, and archive sizes before replacing the displayed model. No GPU status is inferred from a prepared bundle.

The result contains:

- `refined.glb`: the refined flat-colored triangle mesh **plus a separate glTF POINTS layer for face decals**. Flat colors use `KHR_materials_unlit`; per-face color boundaries are preserved by splitting vertices. Face points disappear in wireframe mode to expose the underlying geometry.
- `refined.ply`: the upstream colored triangle mesh.
- `decal.ply`: the upstream face decal point cloud.
- `preview.png`: the upstream stylized front-view rendering.
- `result.json`: the exact input manifest and output metadata.

The GLB does **not** reproduce the paper's camera-dependent deformation or Freestyle line rendering. Those are represented by the preview. Decal points can look different at oblique angles, and other GLB viewers may display points differently. A single watertight triangle mesh with baked face details would require an additional baking/retopology step.

This method was designed for flat-colored hand-drawn model sheets. Shaded, photographic, or inconsistent generated views may lose PBR appearance or fail to improve likeness. Compare the result against the retained original in the app before adopting it. TRELLIS.2 remains the default generation path until refinement has been tested on a GPU and assessed visually.

Upstream: [ModelSheetTo3D](https://github.com/hjyoon02/ModelSheetTo3D), [APAP](https://github.com/KAIST-Visual-AI-Group/APAP), [Informative Drawings](https://github.com/carolineec/informative-drawings).
