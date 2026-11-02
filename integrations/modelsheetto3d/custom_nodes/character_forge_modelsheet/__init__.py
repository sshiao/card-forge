"""Comfy output node for Character Forge's ModelSheetTo3D adapter."""
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid
import os

import folder_paths

ROOT = Path(__file__).resolve().parent


class CharacterForgeModelSheetRefine:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"bundle": ("STRING", {"default": ""})}}

    RETURN_TYPES = ()
    FUNCTION = "refine"
    CATEGORY = "Character Forge"
    OUTPUT_NODE = True

    def refine(self, bundle):
        source = Path(folder_paths.get_annotated_filepath(bundle)).resolve()
        input_root = Path(folder_paths.get_input_directory()).resolve()
        if not source.is_relative_to(input_root) or not source.is_file():
            raise ValueError("Refinement bundle must be an uploaded input file")
        output_root = Path(folder_paths.get_output_directory())
        subfolder = "character-forge-refinement"
        output = output_root / subfolder / f"result-{uuid.uuid4().hex}.zip"
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="modelsheet-") as work:
            subprocess.run([
                sys.executable, str(ROOT / "run.py"), str(source),
                "--repo", str(ROOT / "vendor/ModelSheetTo3D"),
                "--drawings", str(ROOT / "vendor/informative-drawings"),
                "--checkpoint", str(ROOT / "models/line-model.pth"),
                "--blender", str(ROOT / "vendor/blender-4.3.2-linux-x64/blender"),
                "--work", work, "--output", str(output),
            ], check=True, timeout=60 * 60, env={**os.environ, "U2NET_HOME": str(ROOT / "models")})
        # Comfy's saved-file protocol; the API proxy exposes this binary artifact.
        return {"ui": {"files": [{"filename": output.name, "subfolder": subfolder, "type": "output"}]}, "result": ()}


NODE_CLASS_MAPPINGS = {"CharacterForgeModelSheetRefine": CharacterForgeModelSheetRefine}
NODE_DISPLAY_NAME_MAPPINGS = {"CharacterForgeModelSheetRefine": "ModelSheetTo3D refinement"}
