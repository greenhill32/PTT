# Dictaphone — Stage 2

This is the same PWA and the same IndexedDB database as Stage 1. **Existing clips stay in place.** The upgrade adds a local review queue, manual transcripts, optional cloud transcription and suggested sorting.

## Use the app

1. Open the existing [Vercel deployment](https://ptt-smoky.vercel.app/) from the Home Screen. If it shows Stage 1, close and reopen once while online to let the new offline shell take over.
2. Record as before; taps and local storage work offline.
3. Open **Clips**. Select **Enter transcript** for an offline manual path or **Process with AI** to send only that chosen clip to OpenAI.
4. Open **Review** to edit text, category, and the optional spoken priority/RPE/REP score. Keep or discard suggestions; discarded items can be restored.
5. Use **Export notes JSON** for a text backup. Audio still has its own **Export audio** button. Nothing is deleted by Stage 2.

A clip can produce several separate review items. An AI-suggested **Noise** item is shown for review, never automatically thrown away. Priority is only extracted when you explicitly speak a score.

## Enable AI processing (one-time Vercel setup)

Stage 2 can run without AI. Its server endpoint returns 503 until **both** of these environment variables are set in the Vercel project settings for the production environment:

- `OPENAI_API_KEY`: an API key for your OpenAI Platform account. This is separate from a ChatGPT subscription.
- `PTT_PROCESSING_CODE`: a random private code **at least 24 characters** long. Set it only in Vercel. The app asks for it the first time you process a clip each session. Never put either value in GitHub or in a URL.

After adding the variables, **redeploy the latest commit** in Vercel. Processing takes place only on an explicit tap while the app is open. The chosen audio travels to the Vercel function, then OpenAI for transcription; the transcript goes to OpenAI once more for splitting and categorization. The server function does not write audio or text to a database. The original recording and returned review items remain in browser storage on the device.

The server accepts at most 2.5 MB of MP4/WebM audio per request. If the server is unavailable, enter a transcript manually. Processing can incur OpenAI API charges, so the endpoint requires the private code. Do not use a short or reusable personal password.

## Data migration and later stages

Opening the app upgrades IndexedDB from v1 to v2 by **adding** a `review_items` object store. It does not clear or rewrite previous recordings. A processed clip keeps its raw transcript and links to review items through `clip_id`. Clips are never automatically deleted, and no note is sent to Google Sheets at this stage.

Stage 3 can add backup and personal sorting preferences to this same data model. If you change static assets later, bump the cache version in `sw.js` so Home Screen installs update. For desktop testing, serve the repository on `http://localhost:8000` with `python3 -m http.server 8000`.
