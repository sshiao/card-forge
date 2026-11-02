# Character Forge 3D submission drafts

> Current as of 2026-11-02 afternoon: the main 3D output is the TripoSplat splat, with its back rebuilt from the sheet's back view and, for photos, the face pass grafted on. TRELLIS.2 is an optional mesh button. ModelSheetTo3D is experimental and should stay out of the demo, because it has not run on a GPU.

Deadline: Tuesday 11/3 at 9 AM PT. Form: https://form.typeform.com/to/V1dSQrkS

Category: **Open Weights Only**. Every model is open weights, and no workflow uses a partner node or a closed API. Best Overall considers every entry automatically. No model-provider bonus applies: LTX, FLUX 3 and MiniMax H3 are not the core model here.

Order of work:

1. Publish the repo on GitHub, for example as `sshiao/character-forge`.
2. Record the demo video and post it, for example on YouTube (unlisted is fine) or X.
3. Post the social post with the video and #OpenSourceHiggsfield.
4. Fill in the form with the links from steps 1 to 3.

---

## 1. Demo video (about 90 seconds)

The rules say judges look at the work, not at video polish, and the video must explain the tools you used. A screen recording of the app is the strongest proof, because it shows that the 3D is live and not a video. Record at 1280×800 or larger. Start the app with `npm run dev`. To record without spending credits, use `FORGE_MOCK=1`, or open a finished character from the roster.

| Time | On screen | Caption | Optional voice-over |
|---|---|---|---|
| 0:00–0:07 | A finished character in the viewer. Drag it all the way round. | One picture. A real 3D character. | "This is Brann. Ten minutes ago he was one line of text." |
| 0:07–0:14 | The create screen | Character Forge 3D · open weights · ComfyUI | "Character Forge turns one portrait into a character you can walk around." |
| 0:14–0:24 | Add a portrait, type a name, pick a style, select Forge | 1 Upload a portrait, or describe your character | "Add a portrait, or describe your character. Pick a name and a style." |
| 0:24–0:36 | The progress screen, then the two candidates | 2 Qwen Image Edit 2511 draws two full-body designs | "Qwen Image Edit turns the portrait into two full-body designs in an A-pose. You approve one, because a body from a headshot is always a guess." |
| 0:36–0:48 | Approve. The sheet, the splat and the face pass run together | 3 A multiple-angles LoRA draws the sheet. TripoSplat builds the splat, and rebuilds the sheet's back view for the back. A face pass rebuilds the head at full resolution. | "From the approved design, a multiple-angles LoRA turns the camera for the sheet, and TripoSplat builds a real Gaussian splat. It also rebuilds the sheet's back view, so the back is drawn, not guessed. In a full-body image the face is only ninety pixels tall, so a second pass rebuilds the head on its own and grafts it on. All native ComfyUI workflows on Comfy Cloud." |
| 0:48–1:05 | The reveal: the flat sheet clears, the splat eases to three-quarter. Then press Compare front image only, and back. | 4 From a flat sheet to live 3D · before and after | (none for the reveal) "From the front image alone, the face is a blur and the back is a guess. With the face pass and the back from the sheet, it's the character you approved." |
| 1:05–1:18 | Drag to the back, zoom in on the face, Reset view, Auto-orbit | Drag · zoom · 262,144 Gaussians | "It is not a video. Drag it, zoom in, look at the back." |
| 1:18–1:26 | The Files tab, then open the standalone viewer | SOG · SPZ · PLY · standalone viewer · sheet | "Download the splat as SOG, SPZ or PLY, or a single HTML viewer that SplatTransform makes." |
| 1:26–1:32 | End card | Open source · MIT · github.com/sshiao/character-forge · #OpenSourceHiggsfield | "It's open source, and every model is open weights. Try it." |

---

## 2. Social post

### X (275 of 280 characters, with the link counted as 23)

> One portrait in. A real 3D character out.
>
> Character Forge 3D turns a picture or a line of text into a full-body design, a character sheet and a Gaussian splat you can spin. Open weights: Qwen Image Edit + TripoSplat on ComfyUI.
>
> github.com/sshiao/character-forge
> #OpenSourceHiggsfield

Attach the demo video, or a 10-second screen recording of the drag-to-rotate.

### LinkedIn or Reddit

> I built Character Forge 3D for Comfy's Open Source Higgsfield challenge.
>
> Upload one portrait, or describe a character in one line. It makes:
>
> - a full-body design in an A-pose, with Qwen Image Edit 2511 (you pick one of two),
> - a four-view character sheet, with Qwen Image Edit and a multiple-angles LoRA,
> - a real 3D Gaussian splat with TripoSplat, which you rotate and zoom in the browser,
> - a face pass: in a full-body image the face is only about 90 pixels tall, so the app rebuilds the head on its own at full resolution and grafts it onto the body splat.
>
> You can download the splat as SOG, SPZ or PLY, or as one HTML viewer. Every model is open weights, and every step is a native ComfyUI workflow on Comfy Cloud. A character takes about two minutes.
>
> It's MIT-licensed: github.com/sshiao/character-forge
>
> #OpenSourceHiggsfield

---

## 3. Form answers

| Field | Answer |
|---|---|
| Name | (yours) |
| Comfy app email | (yours) |
| Country | (yours) |
| Social handles, Discord, Reddit | (optional, yours) |
| How familiar were you with ComfyUI | (your choice) |
| Project name/title | Character Forge 3D |
| One-line description (97 of 100 characters) | Turn one portrait into a character sheet and a real 3D Gaussian splat you can spin. Open weights. |
| GitHub repo URL | https://github.com/sshiao/character-forge |
| Demo video URL | (the link from step 2) |
| Live link | Leave blank, or a link to a host you run. The app needs a long-running Node server and your Comfy key. |
| Social post link | (the link from step 3) |
| Category | Open Weights Only |
| Which parts of ComfyUI | Comfy Cloud API, Comfy SDK (@comfyorg/sdk), native TripoSplat and Gaussian splat nodes (TripoSplatConditioning, VAEDecodeTripoSplat, SplatToFile3D, RenderSplat, CreateCameraInfo), Qwen Image Edit nodes, workflow templates exported in API format |
| Generative models | Qwen Image 2512 with the Lightning 4-step LoRA (portrait from text); Qwen Image Edit 2511 with the Lightning 4-step LoRA (canonical full body and the face-pass image); Qwen Image Edit 2511 multiple-angles LoRA (character sheet); BiRefNet (cutout); TripoSplat with DINOv3 ViT-H and the FLUX.2 VAE (body splat and face splat); TRELLIS.2 (optional textured mesh). All open weights. |
