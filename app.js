const $ = (selector) => document.querySelector(selector);
const state = { book: null, chapters: [], outputs: [], controller: null };
const MAX_CHARS = 3600;

const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const bookPanel = $("#bookPanel");
const chapterList = $("#chapterList");
const generateButton = $("#generate");

$("#pickFile").addEventListener("click", () => fileInput.click());
$("#changeBook").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => fileInput.files[0] && loadEpub(fileInput.files[0]));
dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault(); dropZone.classList.remove("dragging");
  const file = event.dataTransfer.files[0];
  if (file) loadEpub(file);
});

$("#toggleKey").addEventListener("click", () => {
  const input = $("#apiKey");
  input.type = input.type === "password" ? "text" : "password";
  $("#toggleKey").textContent = input.type === "password" ? "Show" : "Hide";
});
$("#apiKey").addEventListener("input", (event) => sessionStorage.setItem("soundleaf-gemini-api-key", event.target.value));
$("#apiKey").value = sessionStorage.getItem("soundleaf-gemini-api-key") || "";
["baseUrl", "model", "voice", "instructions"].forEach((id) => {
  const el = $("#" + id);
  const saved = localStorage.getItem("soundleaf-gemini-" + id);
  if (saved) el.value = saved;
  el.addEventListener("change", () => localStorage.setItem("soundleaf-gemini-" + id, el.value));
});

$("#selectAll").addEventListener("change", (event) => {
  document.querySelectorAll(".chapter-check").forEach((box) => { box.checked = event.target.checked; });
  updateSelection();
});
$("#generate").addEventListener("click", generateAudiobook);
$("#cancel").addEventListener("click", () => state.controller?.abort());
$("#downloadZip").addEventListener("click", downloadZip);

async function loadEpub(file) {
  if (!file.name.toLowerCase().endsWith(".epub")) return toast("Please choose an .epub file");
  try {
    toast("Parsing EPUB…");
    const zip = await JSZip.loadAsync(file);
    const container = parseXml(await zip.file("META-INF/container.xml").async("text"));
    const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
    if (!opfPath || !zip.file(opfPath)) throw new Error("Could not find the EPUB content manifest");
    const opf = parseXml(await zip.file(opfPath).async("text"));
    const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const title = nodeText(opf, "title") || file.name.replace(/\.epub$/i, "");
    const author = nodeText(opf, "creator") || "Unknown author";
    const manifest = new Map([...opf.querySelectorAll("manifest item")].map((item) => [item.getAttribute("id"), item.getAttribute("href")]));
    const spine = [...opf.querySelectorAll("spine itemref")].map((item) => item.getAttribute("idref"));
    const chapters = [];
    for (const id of spine) {
      const href = manifest.get(id);
      if (!href) continue;
      const fullPath = resolveZipPath(base, href.split("#")[0]);
      const entry = zip.file(fullPath);
      if (!entry) continue;
      const doc = new DOMParser().parseFromString(await entry.async("text"), "text/html");
      doc.querySelectorAll("script, style, nav, svg").forEach((node) => node.remove());
      const heading = doc.querySelector("h1, h2, h3, title")?.textContent?.trim();
      const text = cleanText(doc.body?.textContent || "");
      if (text.length < 20) continue;
      chapters.push({ title: heading || `Chapter ${chapters.length + 1}`, text, selected: true });
    }
    if (!chapters.length) throw new Error("No readable chapters were found");
    state.book = { title, author, filename: file.name };
    state.chapters = chapters;
    state.outputs.forEach((item) => URL.revokeObjectURL(item.url));
    state.outputs = [];
    renderBook();
    toast(`Found ${chapters.length} chapters`);
  } catch (error) {
    console.error(error);
    toast(`Could not parse this EPUB: ${error.message}`);
  }
}

function renderBook() {
  $("#bookTitle").textContent = state.book.title;
  $("#bookMeta").textContent = `${state.book.author} · ${state.chapters.length} chapters`;
  chapterList.innerHTML = state.chapters.map((chapter, index) => `
    <div class="chapter">
      <input class="chapter-check" type="checkbox" data-index="${index}" checked />
      <div><div class="chapter-title">${escapeHtml(chapter.title)}</div><div class="chapter-meta">${chapter.text.length.toLocaleString()} characters</div></div>
      <button class="chapter-preview" data-preview="${index}">Preview text</button>
    </div>`).join("");
  chapterList.querySelectorAll(".chapter-check").forEach((box) => box.addEventListener("change", updateSelection));
  chapterList.querySelectorAll("[data-preview]").forEach((button) => button.addEventListener("click", () => {
    const chapter = state.chapters[Number(button.dataset.preview)];
    alert(`${chapter.title}\n\n${chapter.text.slice(0, 1200)}${chapter.text.length > 1200 ? "…" : ""}`);
  }));
  dropZone.classList.add("hidden");
  bookPanel.classList.remove("hidden");
  $("#resultCard").classList.add("hidden");
  $("#progressCard").classList.add("hidden");
  updateSelection();
}

function updateSelection() {
  const checks = [...document.querySelectorAll(".chapter-check")];
  const selected = checks.filter((box) => box.checked);
  $("#selectedSummary").textContent = `${selected.length} of ${checks.length} selected`;
  $("#selectAll").checked = checks.length > 0 && selected.length === checks.length;
  $("#selectAll").indeterminate = selected.length > 0 && selected.length < checks.length;
  generateButton.disabled = selected.length === 0;
}

async function generateAudiobook() {
  const key = $("#apiKey").value.trim();
  if (!key) return toast("Enter your API key first");
  const selectedIndexes = [...document.querySelectorAll(".chapter-check:checked")].map((box) => Number(box.dataset.index));
  if (!selectedIndexes.length) return toast("Select at least one chapter");
  state.controller = new AbortController();
  state.outputs.forEach((item) => URL.revokeObjectURL(item.url));
  state.outputs = [];
  setGenerating(true);
  $("#progressCard").classList.remove("hidden");
  $("#resultCard").classList.add("hidden");
  const jobs = selectedIndexes.flatMap((chapterIndex) => splitText(state.chapters[chapterIndex].text).map((text, partIndex, parts) => ({ chapterIndex, partIndex, partCount: parts.length, text })));
  try {
    const pieces = new Map();
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const chapter = state.chapters[job.chapterIndex];
      updateProgress(i, jobs.length, `${chapter.title}${job.partCount > 1 ? ` · Part ${job.partIndex + 1}/${job.partCount}` : ""}`);
      const blob = await synthesize(job.text, key, state.controller.signal);
      if (!pieces.has(job.chapterIndex)) pieces.set(job.chapterIndex, []);
      pieces.get(job.chapterIndex).push(blob);
    }
    for (const chapterIndex of selectedIndexes) {
      const chapter = state.chapters[chapterIndex];
      const blob = await mergeWavBlobs(pieces.get(chapterIndex));
      state.outputs.push({ index: chapterIndex, title: chapter.title, blob, url: URL.createObjectURL(blob) });
    }
    updateProgress(jobs.length, jobs.length, "All chapters have been generated");
    renderResults();
  } catch (error) {
    if (error.name === "AbortError") toast("Generation stopped");
    else { console.error(error); toast(`Generation failed: ${error.message}`); }
  } finally {
    setGenerating(false);
    state.controller = null;
  }
}

async function synthesize(input, key, signal) {
  const baseUrl = $("#baseUrl").value.trim().replace(/\/$/, "");
  const model = $("#model").value.trim();
  const part = { text: input };
  const instructions = $("#instructions").value.trim();
  if (instructions) part.speech_metadata = { style: instructions };
  const body = {
    contents: [{ role: "user", parts: [part] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      responseFormat: { audio: { mimeType: "AUDIO_WAV", sampleRate: 24000 } },
      speechConfig: { voiceConfig: { voice: $("#voice").value } },
    },
  };
  const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { const data = await response.json(); message = data.error?.message || message; } catch {}
    throw new Error(message);
  }
  const data = await response.json();
  const audio = data.candidates?.[0]?.content?.parts?.find((item) => item.inlineData)?.inlineData;
  if (!audio?.data) throw new Error("Gemini returned no audio. Check the model, voice, and content safety response.");
  return base64ToBlob(audio.data, audio.mimeType || "audio/wav");
}

function renderResults() {
  $("#resultSummary").textContent = `${state.outputs.length} chapters generated. Preview them, download individual WAV files, or save the complete ZIP.`;
  $("#audioList").innerHTML = state.outputs.map((item, i) => `
    <div class="audio-item">
      <strong>${escapeHtml(item.title)}</strong>
      <audio controls src="${item.url}"></audio>
      <a href="${item.url}" download="${filename(i + 1, item.title)}.wav">Download WAV</a>
    </div>`).join("");
  $("#resultCard").classList.remove("hidden");
  $("#resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function downloadZip() {
  if (!state.outputs.length) return;
  toast("Creating ZIP…");
  const zip = new JSZip();
  state.outputs.forEach((item, i) => zip.file(`${filename(i + 1, item.title)}.wav`, item.blob));
  zip.file("README.txt", `${state.book.title}\n${state.book.author}\n\nGenerated with SoundLeaf.`);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${safeName(state.book.title)}-audiobook.zip`);
}

function setGenerating(active) {
  generateButton.classList.toggle("hidden", active);
  $("#cancel").classList.toggle("hidden", !active);
  document.querySelectorAll("input, select, textarea").forEach((el) => { if (!el.closest(".progress-card")) el.disabled = active; });
}
function updateProgress(done, total, detail) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  $("#progressPercent").textContent = `${percent}%`;
  $("#progressBar").style.width = `${percent}%`;
  $("#progressTitle").textContent = done === total ? "Generation complete" : "Generating audio";
  $("#progressDetail").textContent = detail;
}
function splitText(text) {
  if (text.length <= MAX_CHARS) return [text];
  const sentences = text.split(/(?<=[。！？.!?])\s*/u);
  const chunks = []; let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_CHARS) { chunks.push(current.trim()); current = ""; }
    if (sentence.length > MAX_CHARS) {
      if (current) chunks.push(current.trim());
      for (let i = 0; i < sentence.length; i += MAX_CHARS) chunks.push(sentence.slice(i, i + MAX_CHARS));
      current = "";
    } else current += sentence + " ";
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
async function mergeWavBlobs(blobs) {
  if (blobs.length === 1) return blobs[0];
  const chunks = [];
  let format = null;
  for (const blob of blobs) {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") throw new Error("Gemini returned an unsupported audio format");
    let offset = 12;
    let currentFormat = null;
    let pcm = null;
    while (offset + 8 <= view.byteLength) {
      const id = readAscii(view, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (id === "fmt ") currentFormat = {
        audioFormat: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true),
        blockAlign: view.getUint16(start + 12, true), bitsPerSample: view.getUint16(start + 14, true),
      };
      if (id === "data") pcm = new Uint8Array(buffer, start, Math.min(size, buffer.byteLength - start));
      offset = start + size + (size % 2);
    }
    if (!currentFormat || !pcm) throw new Error("Could not read Gemini WAV audio");
    if (!format) format = currentFormat;
    if (JSON.stringify(format) !== JSON.stringify(currentFormat)) throw new Error("Gemini returned mismatched WAV formats between segments");
    chunks.push(new Uint8Array(pcm));
  }
  const dataSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, format.audioFormat, true);
  view.setUint16(22, format.channels, true); view.setUint32(24, format.sampleRate, true); view.setUint32(28, format.byteRate, true);
  view.setUint16(32, format.blockAlign, true); view.setUint16(34, format.bitsPerSample, true);
  writeAscii(view, 36, "data"); view.setUint32(40, dataSize, true);
  const bytes = new Uint8Array(output); let cursor = 44;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  return new Blob([output], { type: "audio/wav" });
}
function readAscii(view, offset, length) { return String.fromCharCode(...new Uint8Array(view.buffer, offset, length)); }
function writeAscii(view, offset, text) { [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0))); }
function resolveZipPath(base, relative) {
  const parts = (base + decodeURIComponent(relative)).split("/"); const output = [];
  for (const part of parts) { if (!part || part === ".") continue; if (part === "..") output.pop(); else output.push(part); }
  return output.join("/");
}
function parseXml(text) { return new DOMParser().parseFromString(text, "application/xml"); }
function nodeText(doc, localName) { return [...doc.getElementsByTagNameNS("*", localName)][0]?.textContent?.trim() || ""; }
function cleanText(text) { return text.replace(/\u00a0/g, " ").replace(/[\t\r ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim(); }
function safeName(value) { return value.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 100) || "audiobook"; }
function filename(number, title) { return `${String(number).padStart(3, "0")}-${safeName(title)}`; }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]); }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.remove("hidden"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add("hidden"), 3500); }
