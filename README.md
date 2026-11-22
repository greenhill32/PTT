# Dictaphone — Stage 1

This builds directly on the capture mock-up in `ptt.html`. The recording button is functional: tap once to start and once to stop. Audio is saved in IndexedDB on the device, can be replayed from **Clips**, and can be exported individually. No account, backend, AI, or network is used for a recording.

An optional spoken `priority seven` or `RPE seven` is preserved in the audio for Stage 2. No score is inferred in this stage.

## Try it on an iPhone

1. After GitHub Pages is enabled for `main` at `/(root)` under **Settings → Pages**, open `https://greenhill32.github.io/PTT/` in Safari while online. GitHub Pages serves the app over **HTTPS**.
2. Add it to the Home Screen through Share → Add to Home Screen.
3. Tap **REC**, grant microphone access, speak, tap the square to stop, and wait for **Saved on this device**.
4. Open **Clips**, replay it, export a copy, and repeat in Airplane Mode. Test screen lock and interruption on your own iPhone; the app stops when hidden, but iOS may suspend it before a final write.

For a desktop development server: `python3 -m http.server 8000` from this directory and open `http://localhost:8000`. `localhost` is a secure context for browser media APIs. The service worker caches the shell after its first successful load. When changing shell assets in later stages, increment `CACHE` in `sw.js` so returning installs receive them.

## Storage and safety

- Audio is held in this browser's IndexedDB. This is **not a durable backup**. Export any important recordings. Browser data removal, device failure, or an iOS eviction may remove it.
- A persistent-storage request is made when recording starts, but a browser may decline it. Storage failures offer a manual download of the unsaved clip while the page remains open.
- There is **no delete function** in Stage 1. No audio leaves the device through this app.
- Always wait for the saved confirmation before closing the app.

## Next stage (extend these files)

Add a foreground processing queue to `app.js` using the existing `audio_clips` store and `status: 'unprocessed'`. Transcribe and split clips into suggested items, with the spoken score as a *hint*, not a mandatory field. Keep review and correction in the same app. Add remote storage only after choosing authenticated access and separately defining whether text or audio is backed up.
