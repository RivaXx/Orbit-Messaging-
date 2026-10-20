# Automatic Orbit introduction

Adapted the orbit camera, core and comet animation from the supplied gemini-code-1792477844739.html. The Enter gate, replay/sound buttons and Everything in motion slogan are removed. The finite introduction runs for 12 seconds, then fades automatically into the existing app. A quieter locally synthesized ambient chord score replaces the original impacts, percussion, risers and random sound effects. No audio is downloaded from another service.

The first visitor sees the introduction before authentication. A successful first sign-in is tracked per account on this device. Signing back in after explicit logout replays it, including Google callbacks. A first-visit introduction is not immediately repeated after signing in on the same page. Ordinary remembered-session restores skip the introduction and retain the existing fast path.

Email sign-in/sign-up gestures prime audio without playing it during the network request. First visits and OAuth redirects remain subject to browser autoplay rules; if sound is blocked the animation continues silently, and a tap during it can enable music. No additional gate or mandatory button is introduced.

Animation and audio are stopped and disposed on completion, Escape, tab hiding or an incoming call. Reduced-motion users see a short static logo. Slow/failed scene loading falls back to the static logo and returns to the app. Drawing uses capped pixel density and a 30fps ceiling; the heavier scene loads only when needed. Offline assets are included in the service worker.

Verification: 103 Node regression tests, including introduction lifecycle, session/account isolation, logout replay, audio denial, reduced motion, delayed loading and scene cleanup. Browser review checked the orbit reveal and automatic return to the dashboard.
