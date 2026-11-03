# Card Forge submission drafts

> Current as of 2026-11-02 night: Card Forge turns a photo into a holo trading card, with nine frames including a 3D glass card. The 3D character app is in git history at the tag `3d-snapshot` and is not part of the entry.

Deadline: Tuesday 11/3 at 9 AM PT. Form: https://form.typeform.com/to/V1dSQrkS

Categories: **Open Weights Only** and **Most Innovative** (the user's choice on 2026-11-02). Every model is open weights, and no workflow uses a partner node or a closed API. The demo video must say why the entry is innovative. Best Overall considers every entry automatically. No model-provider bonus applies: LTX, FLUX 3 and MiniMax H3 are not the core model here.

Order of work:

1. Publish the repo on GitHub as `sshiao/card-forge`.
2. Post the demo video on X with #OpenSourceHiggsfield.
3. Fill in the form with the links from steps 1 and 2.

Keep real people out of the video and the posts unless they agree. Mara is a generated person who does not exist. Keep any real trading card art, and any famous characters, out too.

---

## 1. Demo video (about 95 seconds, under the 2-minute limit)

Recorded from the app with real Comfy Cloud runs on Mara, a generated person, against a second server that keeps its own cards (`FORGE_CARDS_DIR`), so no one else's cards show. The voiceover is Qwen3-TTS 1.7B (voice "Aiden"), also on Comfy Cloud. The waits for Comfy Cloud are sped up, and the captions say so.

| Scene | On screen | Voiceover |
|---|---|---|
| 1 | Mara's photo, then her glass card turning | "This is Mara. A minute ago, she was a photo. Now she's a holo trading card." |
| 2 | The create screen: photo, Gold rare, Anime, Own clothes, Forge | "Card Forge turns one photo into a trading card. Add a photo, pick a frame and an art style, and keep your own clothes, or ask for a hero outfit." |
| 3 | The progress screen, sped up | "First, Qwen3-VL reads the photo and writes the card: a name, an element from your colors, HP, an ability, two moves, and flavor text that fit you." |
| 4 | The art paints, then the review: pick one | "Then Qwen Image Edit paints you as the hero, twice. Pick the one that looks most like you, or say what to change." |
| 5 | Tilt the card, switch through five frames | "The browser draws the card as code, so every line stays sharp and editable. There are nine original frames, from vintage holo to a chrome sports card, and the foil follows the light." |
| 6 | Future glass: paint the cutout, pick it, spin the 3D card | "The newest frame is Future Glass. BiRefNet cuts you out of the art, and Three.js builds a see-through 3D card around you. Spin it all the way round." |
| 7 | Edit a move, download the PNG and the video | "Edit any line, then download the card as a PNG, or the glass card as a turntable video." |
| 8 | Slide: how it's built | "Every step is a ComfyUI workflow on Comfy Cloud, run through the Comfy SDK, and every model is open weights. Even this voice is Qwen3-TTS." |
| 9 | Slide: what's new | "What's new? A vision model turns your photo into game-ready card data, and the cards are code, not pixels, so a flat cutout becomes a 3D collectible." |
| 10 | End card | "Card Forge is open source, under MIT. Make yours." |

---

## 2. Social post (X, 271 of 280 characters, with the link counted as 23)

> One photo in. One holo trading card out.
>
> Card Forge reads your photo, writes your card, paints you as the hero, and builds a 3D glass card you can spin. Open weights only: Qwen3-VL, Qwen Image Edit and BiRefNet on @ComfyUI.
>
> github.com/sshiao/card-forge
> #OpenSourceHiggsfield

Attach the demo video.

---

## 3. Form answers

| Field | Answer |
|---|---|
| Name, Comfy app email, country | (the user types these) |
| Social handles, Discord, Reddit | (optional, the user's) |
| How familiar were you with ComfyUI | Used it regularly |
| Project name/title | Card Forge |
| One-line description (94 of 100 characters) | Turn a photo into a holo trading card: open-weights models write it and paint you as the hero. |
| GitHub repo URL | https://github.com/sshiao/card-forge |
| Demo video URL | (the X post, or another link to the video) |
| Live link | Leave blank. The app needs a long-running Node server and a Comfy key. |
| Social post link | (the X post) |
| Which parts of ComfyUI | Comfy API, Comfy SDK |
| Generative models | Qwen3-VL-8B-Instruct (card text); Qwen Image Edit 2511 with the Lightning 4-step LoRA (hero art); BiRefNet (cutout for the 3D glass card); Qwen3-TTS 1.7B (demo voiceover). All open weights. |
| Other tools or techniques | Next.js app on @comfyorg/sdk, with ComfyUI workflows in API format: ComfyUI-QwenVL (AILab_QwenVL_Advanced) with SaveText for the card JSON, TextEncodeQwenImageEditPlus and FluxKontextMultiReferenceLatentMethod for the art, and the core LoadBackgroundRemovalModel, RemoveBackground, InvertMask and JoinImageWithAlpha nodes for the cutout. The browser draws nine original frames as SVG, with CSS foil that follows the pointer, and the glass card in Three.js. Mediabunny encodes its turntable video with WebCodecs. A parser checks every field of the model's JSON, so a bad answer cannot break a card. |
| Categories | Open Weights Only, Most Innovative |
| Is your stack fully open? | Yes |
| Agreements | All four, only with the user's OK |
| Anything else | All art and text in the demo come from real Comfy Cloud runs. Mara is a generated person who does not exist. |
