# Doris

A magic-prank app in the spirit of the old "My Pet Boris": photograph a spectator's
palm, lay the phone on their hand, wave — and a cockroach (or spider, or earthworm)
scuttles across their palm on screen. Wave again and it doesn't come back... because
it's now a plastic one sitting on the back of their hand.

The main menu just looks like a "palm scanner". Creature settings sit behind the
faint gear icon at the bottom right.

## The routine

1. **Scan** – rear camera opens with a live hand-tracking skeleton (pure show).
   Frame the spectator's palm and press the shutter.
2. The photo now fills the screen with no UI. Place the phone on their palm.
3. Run the **sequence** (Settings → Sequence). Default:
   1. **Cockroach**, started by a wave over the phone. It walks in, crosses the
      palm (pausing on it) and leaves.
   2. **Finger**, 0.4 s after the roach has gone (see below).
   After the last step nothing more happens: wave again and it doesn't come back.
4. Put the phone on your own hand, have them wave… and they find the plastic bug.

**Sequence:** a list of steps, each a creature (cockroach / spider / earthworm)
or the finger. Each step has its own start signal: *Wave*, *Tap*, *2× tap*,
*3× tap* or *Time* (seconds after the photo, or after the previous step ends).
Add, remove and reorder steps; *Reset to default* restores the two above.

**Hidden controls on the photo screen**

| Gesture | Action |
|---|---|
| Wave over the phone | Starts a *Wave* step (arms after the phone has lain still ~1 s) |
| 1 / 2 / 3 quick taps | Starts a *Tap* / *2× tap* / *3× tap* step (2 taps also back up a wave) |
| 5 quick taps, or long-press (~1 s) | Exit to the menu |
| Tap while the creature is visible | Finger scratches its back (*Finger scratches creature: On tap*) |

**Finger step:** a few pixels of fingertip peek in at the right screen edge (lower
third) for about a second. That's your cue: slide your real finger in under the
phone from that side, palm side up, at the same speed as the screen finger, which
travels diagonally up into the screen, so it looks like you're seeing your finger
through the phone. Cue length, slide time and entry point (left / right edge,
bottom-left / bottom / bottom-right) are in Settings. The drawn finger shows the
pad (palm side) by default, or the nail. For the most realistic result use
*Finger look → Use my finger*: photograph your own index finger, held straight,
palm side to the camera, against a plain non-skin background; hand tracking and a
colour key cut it out and it replaces the drawn one.

## Settings

Sequence, wave sensitivity, delay after wave / tap, creature entry side, size and
speed, finger scratch, finger entry / timing / look / size, footstep vibration
(Android), hand-tracking overlay on/off. **Preview** plays the whole sequence (each
step half a second after the last) over the last photo, or a fake skin backdrop.

## How the creatures work

No video files: each creature is drawn procedurally every frame so it really walks
*over your photo*.

- **Cockroach:** a rigged, textured 3D model rendered in Blender (Cycles) as a
  16-frame top-down walk cycle (`assets/roach.webp`). The cycle advances with
  distance travelled so planted feet don't slide, with leg motion blur at speed.
  Model: ["Cockroach"](https://sketchfab.com/3d-models/cockroach-cead55b8aa8643d48d67240bad028592)
  by xcellf, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
  (antennae re-posed to lie flat). Rebuild with `tools/roach_model.py` (run inside
  Blender, model unzipped in `tools/models/xcellf`) and `tools/pack_sprites.py`.
  `tools/roach_blender.py` is the older fully procedural roach.
- **Spider (and roach fallback):** feet are planted in world space and only lift during their
  swing phase (alternating tripod gait for the roach, alternating tetrapod for the
  spider), with IK-solved legs, so nothing slides. Darting/pausing behaviour, probing
  antennae, twitching palps.
- **Earthworm:** follow-the-leader body with a travelling peristaltic wave, a wet
  specular streak, segment rings and clitellum.
- Two-layer shadow (soft cast + tight contact) and automatic darkening/tint to match
  the photo's exposure.

Hand tracking uses MediaPipe Hand Landmarker (loaded from CDN, cached by the service
worker after first use).

## Running it

It's a static PWA, no build step.

```bash
node serve.js
```

Then open http://localhost:8080. Cameras only work on **HTTPS or localhost**, so to
use it on a phone, host the folder on any static HTTPS host (GitHub Pages, Netlify,
Cloudflare Pages…) and open it there.

**Install it to the home screen** ("Add to Home Screen" / "Install app") – it then
launches full screen without browser chrome, which matters for the trick
(especially on iPhone, where Safari can't go full screen otherwise).

Notes:
- Wave detection uses the front camera; some phones show a camera-in-use dot.
  Switch to Tap or Timer mode if you'd rather avoid that.
- Vibration footsteps work on Android only (iOS doesn't expose vibration to web apps).
