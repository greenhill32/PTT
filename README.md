# Dictaphone — Stage 3

This is the same PWA and IndexedDB database as Stages 1 and 2. **Existing clips stay in place.** This stage adds a per-clip Share audio button for the Drive-based nightly sorting workflow; Stage 2's local review and optional OpenAI path remain available.

## Use the app

1. Open the existing [Vercel deployment](https://ptt-smoky.vercel.app/) from the Home Screen. If it shows Stage 1, close and reopen once while online to let the new offline shell take over.
2. Record as before; taps and local storage work offline.
3. Open **Clips**, tap **Share audio** for a clip, select Google Drive in the iPhone Share sheet, and save to **PTT / Input**. Check the upload in Drive. The button cannot select a Drive folder or verify an upload for you. Use **Export audio** if file sharing is unavailable. The original clip stays on the phone.
4. For the previous Stage 2 workflow, select **Enter transcript** for an offline manual path or **Process with AI** to send only that chosen clip to OpenAI.
5. Open **Review** to edit text, category, and the optional spoken priority/RPE/REP score. Keep or discard suggestions; discarded items can be restored.
6. Use **Export notes JSON** for a text backup. Nothing is deleted by this stage.

The scheduled Drive workflow is separate from the PWA. It checks the **Input** folder at 18:00 Europe/London, transcribes new audio with Whisper, and reads a clear closing "RPE ten" as Keep or "RPE one" as Rubbish. Other or uncertain scores remain in Input for review. It stores results as JSON beside the audio; this stage does not import those results back into the phone's Review screen. Drive is a cloud copy of audio. Sharing through the iPhone Share sheet is manual and does not prove that Drive has completed its upload.

A clip can produce several separate review items. An AI-suggested **Noise** item is shown for review, never automatically thrown away. Priority is only extracted when you explicitly speak a score.

## Enable AI processing (one-time Vercel setup)

Stage 2 can run without AI. Its server endpoint returns 503 until **both** of these environment variables are set in the Vercel project settings for the production environment:

- `OPENAI_API_KEY`: an API key for your OpenAI Platform account. This is separate from a ChatGPT subscription.
- `PTT_PROCESSING_CODE`: a random private code **at least 24 characters** long. Set it only in Vercel. The app asks for it the first time you process a clip each session. Never put either value in GitHub or in a URL.

After adding the variables, **redeploy the latest commit** in Vercel. Processing takes place only on an explicit tap while the app is open. The chosen audio travels to the Vercel function, then OpenAI for transcription; the transcript goes to OpenAI once more for splitting and categorization. The server function does not write audio or text to a database. The original recording and returned review items remain in browser storage on the device.

The server accepts at most 2.5 MB of MP4/WebM audio per request. If the server is unavailable, enter a transcript manually. Processing can incur OpenAI API charges, so the endpoint requires the private code. Do not use a short or reusable personal password.

## Data migration and later stages

Opening the app upgrades IndexedDB from v1 to v2 by **adding** a `review_items` object store. It does not clear or rewrite previous recordings. A processed clip keeps its raw transcript and links to review items through `clip_id`. Clips are never automatically deleted, and no note is sent to Google Sheets at this stage.

Later stages can import Drive results into Review and learn from your Keep/Rubbish decisions. If you change static assets later, bump the cache version in `sw.js` so Home Screen installs update. For desktop testing, serve the repository on `http://localhost:8000` with `python3 -m http.server 8000`.
