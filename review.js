import { getItems, saveProcessing, updateItem } from './db.js';

const CATEGORIES = ['Task', 'Idea', 'Observation', 'Gym_Log', 'Noise'];
let processingCode = ''; // Memory only; never saved in the app or repository.
let busy = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function encodeAudio(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(binary);
}

function categorySelect(value) {
  const select = element('select');
  for (const category of CATEGORIES) {
    const option = element('option', category.replace('_', ' '));
    option.value = category; option.selected = category === value; select.append(option);
  }
  return select;
}

function prioritySelect(value) {
  const select = element('select');
  const none = element('option', 'No score'); none.value = ''; select.append(none);
  for (let n = 1; n <= 10; n++) {
    const option = element('option', String(n)); option.value = String(n); select.append(option);
  }
  select.value = value == null ? '' : String(value);
  return select;
}

export async function pendingCount() {
  return (await getItems()).filter(item => item.status === 'pending').length;
}

export function attachReview(card, clip, onChange) {
  const info = element('p', '', 'clip-info');
  card.append(info);
  if (clip.status !== 'unprocessed') {
    info.textContent = 'Transcript: ' + (clip.transcript || 'No transcript saved.');
    return;
  }
  info.textContent = 'Waiting for review. Audio stays here until you choose to process it.';
  const actions = element('div', '', 'actions');
  const ai = element('button', 'Process with AI');
  const manual = element('button', 'Enter transcript');
  const entry = element('div', '', 'manual-entry'); entry.hidden = true;
  const input = element('textarea'); input.placeholder = 'Type or paste what you said'; input.maxLength = 6000;
  const save = element('button', 'Save transcript');
  const status = element('p', '', 'clip-info'); status.setAttribute('role', 'status');
  const disclosure = element('p', 'Processing sends this clip to OpenAI for transcription and suggested sorting. Your saved audio remains on this phone.', 'clip-info');
  entry.append(input, save);
  actions.append(ai, manual);
  card.append(disclosure, actions, entry, status);

  manual.addEventListener('click', () => { entry.hidden = !entry.hidden; if (!entry.hidden) input.focus(); });
  save.addEventListener('click', async () => {
    const transcript = input.value.trim();
    if (!transcript) { status.textContent = 'Enter a transcript first.'; return; }
    save.disabled = true;
    try {
      await saveProcessing(clip.clip_id, transcript, [{ text: transcript, category: 'Observation', priority: null }], 'manual');
      info.textContent = 'Transcript: ' + transcript;
      actions.remove(); entry.remove(); disclosure.remove();
      status.textContent = 'Saved. Open Review to edit and keep the item.';
      await onChange();
    } catch (error) { status.textContent = 'Could not save: ' + error.message; save.disabled = false; }
  });

  ai.addEventListener('click', async () => {
    if (busy) return;
    if (!navigator.onLine) { status.textContent = 'You are offline. Your clip is safe; try again online.'; return; }
    if (clip.audio_blob.size > 2_500_000) { status.textContent = 'Clip is over 2.5 MB. Export it or enter a transcript manually.'; return; }
    try {
      const check = await fetch('./api/process', { cache: 'no-store' });
      const state = await check.json();
      if (!state.ready) { status.textContent = 'AI is not configured yet. Enter a transcript manually, or set the two Vercel environment variables.'; return; }
    } catch { status.textContent = 'AI service is unavailable. Your clip is safe; enter a transcript manually or try again later.'; return; }
    if (!processingCode) {
      const entered = prompt('Enter your private processing code (set in Vercel). It stays in memory until you close the app.');
      if (!entered) return;
      processingCode = entered;
    }
    busy = true; ai.disabled = true; status.textContent = 'Transcribing and sorting… Keep this screen open.';
    try {
      const response = await fetch('./api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ptt-code': processingCode },
        body: JSON.stringify({ audio: await encodeAudio(clip.audio_blob), mime: clip.mime_type }),
        cache: 'no-store'
      });
      const result = await response.json();
      if (response.status === 401) processingCode = '';
      if (!response.ok) throw new Error(result.error || 'Could not process this clip.');
      await saveProcessing(clip.clip_id, result.transcript, result.suggestions, 'ai');
      info.textContent = 'Transcript: ' + result.transcript;
      actions.remove(); entry.remove(); disclosure.remove();
      status.textContent = result.warning || 'Suggestions saved locally. Open Review to confirm them.';
      await onChange();
    } catch (error) {
      status.textContent = error.message + ' Original audio has not been changed.';
      ai.disabled = false;
    } finally { busy = false; }
  });
}

export async function openNotes(onChange) {
  const sheet = document.getElementById('notes-sheet');
  const list = document.getElementById('notes-list');
  list.replaceChildren();
  try {
    const items = await getItems();
    if (!items.length) list.append(element('p', 'No suggestions yet. Open Clips and choose Process with AI or Enter transcript.', 'empty'));
    for (const status of ['pending', 'confirmed', 'discarded']) {
      const group = items.filter(item => item.status === status);
      if (!group.length) continue;
      list.append(element('h2', status === 'pending' ? 'To review (' + group.length + ')' : status === 'confirmed' ? 'Kept (' + group.length + ')' : 'Discarded (' + group.length + ')', 'group-heading'));
      for (const item of group) {
        const card = element('article', '', 'note-card');
        const date = element('small', new Date(item.captured_at).toLocaleString());
        const text = element('textarea'); text.value = item.text; text.maxLength = 2000; text.setAttribute('aria-label', 'Thought text');
        const controls = element('div', '', 'note-fields');
        const category = categorySelect(item.category);
        const priority = prioritySelect(item.priority);
        category.setAttribute('aria-label', 'Category'); priority.setAttribute('aria-label', 'Priority');
        controls.append(category, priority);
        const buttons = element('div', '', 'actions');
        const keep = element('button', status === 'confirmed' ? 'Save changes' : 'Keep');
        const discard = element('button', status === 'discarded' ? 'Restore to review' : 'Discard');
        const saveStatus = element('p', '', 'clip-info'); saveStatus.setAttribute('role', 'status');
        buttons.append(keep, discard);
        card.append(date, text, controls, buttons, saveStatus);
        list.append(card);
        const savePatch = async (nextStatus) => {
          const clean = text.value.trim();
          if (!clean) { saveStatus.textContent = 'Text cannot be empty.'; return; }
          keep.disabled = true; discard.disabled = true;
          try {
            await updateItem(item.item_id, {
              text: clean, category: category.value,
              priority: priority.value ? Number(priority.value) : null,
              status: nextStatus
            });
            await onChange();
            await openNotes(onChange);
          } catch (error) {
            saveStatus.textContent = 'Could not save: ' + error.message;
            keep.disabled = false; discard.disabled = false;
          }
        };
        keep.addEventListener('click', () => savePatch('confirmed'));
        discard.addEventListener('click', () => savePatch(status === 'discarded' ? 'pending' : 'discarded'));
      }
    }
    sheet.hidden = false;
    document.getElementById('notes-close').focus();
  } catch {
    list.append(element('p', 'Could not load local notes.', 'empty'));
    sheet.hidden = false;
  }
}

export async function exportNotes() {
  const items = await getItems();
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a'); link.href = url; link.download = 'dictaphone-notes-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
