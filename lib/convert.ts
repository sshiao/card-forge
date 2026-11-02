// Local file work: SplatTransform turns the splat into web formats, and ffmpeg lays out the sheet.

import { spawn } from "node:child_process";
import { join } from "node:path";

function run(command: string, args: string[], what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-2000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${what} failed (exit ${code}): ${errors.trim().split("\n").pop() ?? ""}`)));
  });
}

const SPLAT_TRANSFORM = join(process.cwd(), "node_modules", "@playcanvas", "splat-transform", "bin", "cli.mjs");

// .sog is the compressed web format. .html is a standalone SuperSplat viewer with the splat inside.
export async function convertSplat(input: string, outputs: string[]) {
  for (const output of outputs) {
    await run(process.execPath, [SPLAT_TRANSFORM, "--quiet", "--overwrite", input, output], "SplatTransform");
  }
}

// The ffmpeg-static package brings its own binary. The bundler rewrites its import path,
// so the path is built from the working directory instead. FFMPEG_PATH overrides it.
function ffmpeg() {
  return process.env.FFMPEG_PATH || join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

export const SHEET_CELL = { width: 600, height: 900 };
const GAP = 24;

// A 2x2 sheet: front and three-quarter on top, side and back below, on the app's dark background.
export async function composeSheet(views: string[], output: string) {
  const { width, height } = SHEET_CELL;
  const cells = views.map((_, index) =>
    `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0b0d14,setsar=1[c${index}]`);
  const layout = `0_0|${width + GAP}_0|0_${height + GAP}|${width + GAP}_${height + GAP}`;
  const filter = `${cells.join(";")};[c0][c1][c2][c3]xstack=inputs=4:layout=${layout}:fill=0x0b0d14,pad=iw+${GAP * 2}:ih+${GAP * 2}:${GAP}:${GAP}:color=0x0b0d14[out]`;
  await run(ffmpeg(), ["-v", "error", "-y", ...views.flatMap((view) => ["-i", view]), "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", output], "ffmpeg");
}

// The poster is the first frame of the orbit video.
export async function posterFrame(video: string, output: string) {
  await run(ffmpeg(), ["-v", "error", "-y", "-i", video, "-frames:v", "1", output], "ffmpeg");
}
