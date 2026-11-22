import { getClips, saveClip } from './db.js';
import { attachReview, openNotes, pendingCount, exportNotes } from './review.js';

const $ = id => document.getElementById(id);
const record = $('record'), timer = $('timer'), ring = $('ring'), wave = $('waveform');
let recorder = null, stream = null, chunks = [], started = 0, tick = null, wakeLock = null;
let mode = 'idle', activeUrls = [];

function message(value, isError = false) {
  $('message').textContent = value;
  $('message').classList.toggle('error', isError);
}

function time(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function display(state) {
  mode = state;
  const recording = state === 'recording';
  ring.classList.toggle('active', recording);
  wave.classList.toggle('active', recording);
  timer.classList.toggle('idle', !recording);
  record.disabled = state === 'starting' || state === 'saving';
  $('record-label').textContent = recording ? '■' : state === 'starting' ? '…' : 'REC';
  $('record-sub').textContent = recording ? '' : state === 'starting' ? 'Opening mic' : 'Tap to record';
  record.setAttribute('aria-label', recording ? 'Stop recording' : 'Start recording');
  $('hint').innerHTML = recording ? 'Tap the square to save your thought.' : 'Say <strong>“priority seven”</strong> or <strong>“RPE seven”</strong> if you want to give the AI a clue later. It is optional.';
  if (!recording) { clearInterval(tick); tick = null; }
}

function releaseMedia() {
  clearInterval(tick); tick = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function mimeOption() {
  for (const type of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return { mimeType: type, audioBitsPerSecond: 64000 };
  }
  return { audioBitsPerSecond: 64000 };
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.indexedDB) {
    message('Recording needs a supported browser on HTTPS. On iPhone, open this site in Safari.', true);
    return;
  }
  display('starting'); message('');
  try {
    // Request within the button press. Safari may prompt for microphone access.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream, mimeOption());
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { message('Recording failed. Please try again.', true); releaseMedia(); display('idle'); };
    recorder.onstop = persistRecording;
    started = Date.now();
    recorder.start(1000);
    timer.textContent = '00:00';
    display('recording');
    tick = setInterval(() => { timer.textContent = time(Math.floor((Date.now() - started) / 1000)); }, 250);
    if (navigator.wakeLock?.request) navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(() => {});
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (error) {
    releaseMedia(); display('idle');
    message(error?.name === 'NotAllowedError' ? 'Microphone access was declined. Allow it in Safari settings and try again.' : 'Could not start recording. Please try again.', true);
  }
}

function stopRecording() {
  if (mode !== 'recording' || !recorder || recorder.state !== 'recording') return;
  display('saving');
  message('Saving recording…');
  recorder.stop();
  // Release tracks after stop; onstop persists the final dataavailable chunk.
  releaseMedia();
}

async function persistRecording() {
  const duration = Math.max(1, Math.round((Date.now() - started) / 1000));
  const mime = recorder?.mimeType || chunks[0]?.type || 'audio/mp4';
  const blob = new Blob(chunks, { type: mime });
  try {
    if (!blob.size) throw new Error('empty recording');
    await saveClip({
      clip_id: crypto.randomUUID(), created_at: new Date(started).toISOString(),
      duration_sec: duration, mime_type: mime, audio_blob: blob,
      status: 'unprocessed', backed_up: false
    });
    message(`Saved on this device (${duration}s).`);
    await refreshCount();
  } catch (error) {
    // Preserve the blob in memory for a manual download if local storage fails.
    message('Could not save on this device. Use Download clip below before leaving this page.', true);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `unsaved-clip-${Date.now()}.${extension(mime)}`;
    link.textContent = 'Download clip';
    link.style.cssText = 'color:#fff;display:block;text-align:center';
    $('message').append(document.createElement('br'), link);
    activeUrls.push(url);
  } finally { recorder = null; chunks = []; timer.textContent = '00:00'; display('idle'); }
}

function extension(mime) { return mime.includes('mp4') ? 'm4a' : mime.includes('webm') ? 'webm' : 'audio'; }

async function refreshCount() {
  try {
    $('count').textContent = (await getClips()).length;
    $('review-count').textContent = await pendingCount();
  }
  catch { message('Local storage is unavailable. Check browser settings.', true); }
}

function clearUrls() { activeUrls.forEach(URL.revokeObjectURL); activeUrls = []; }

async function openClips() {
  try {
    const clips = await getClips();
    clearUrls(); $('clips').replaceChildren();
    if (!clips.length) {
      const empty = document.createElement('p'); empty.className = 'empty';
      empty.textContent = 'No recordings yet. Tap REC to capture your first thought.';
      $('clips').append(empty);
    }
    for (const clip of clips) {
      const item = document.createElement('article'); item.className = 'clip';
      const head = document.createElement('div'); head.className = 'clip-head';
      const title = document.createElement('strong'); title.textContent = new Date(clip.created_at).toLocaleString();
      const length = document.createElement('small'); length.textContent = time(clip.duration_sec);
      head.append(title, length);
      const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none';
      const url = URL.createObjectURL(clip.audio_blob); activeUrls.push(url); audio.src = url;
      const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = 'Export audio';
      exportButton.addEventListener('click', () => {
        const link = document.createElement('a'); link.href = url;
        link.download = `thought-${clip.created_at.replace(/[:.]/g, '-')}.${extension(clip.mime_type)}`;
        document.body.append(link); link.click(); link.remove();
      });
      item.append(head, audio, exportButton);
      attachReview(item, clip, refreshCount);
      $('clips').append(item);
    }
    $('sheet').hidden = false;
    $('close').focus();
  } catch { message('Could not read saved clips.', true); }
}

record.addEventListener('click', () => { if (mode === 'recording') stopRecording(); else if (mode === 'idle') startRecording(); });
$('review').addEventListener('click', openClips);
$('notes-open').addEventListener('click', () => openNotes(refreshCount));
$('notes-close').addEventListener('click', () => { $('notes-sheet').hidden = true; record.focus(); });
$('notes-sheet').addEventListener('click', event => { if (event.target === $('notes-sheet')) $('notes-close').click(); });
$('notes-export').addEventListener('click', () => exportNotes().catch(() => message('Could not export notes.', true)));
$('close').addEventListener('click', () => { $('sheet').hidden = true; clearUrls(); record.focus(); });
$('sheet').addEventListener('click', event => { if (event.target === $('sheet')) $('close').click(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'recording') stopRecording();
  if (!document.hidden) refreshCount();
});
function updateOnline() { $('connection').textContent = navigator.onLine ? 'Ready to record' : 'Ready offline'; }
window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
updateOnline(); refreshCount();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
