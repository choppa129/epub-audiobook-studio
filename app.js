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
  $("#toggleKey").textContent = input.type === "password" ? "显示" : "隐藏";
});
$("#apiKey").addEventListener("input", (event) => sessionStorage.setItem("soundleaf-api-key", event.target.value));
$("#apiKey").value = sessionStorage.getItem("soundleaf-api-key") || "";
["baseUrl", "model", "voice", "instructions"].forEach((id) => {
  const el = $("#" + id);
  const saved = localStorage.getItem("soundleaf-" + id);
  if (saved) el.value = saved;
  el.addEventListener("change", () => localStorage.setItem("soundleaf-" + id, el.value));
});

$("#selectAll").addEventListener("change", (event) => {
  document.querySelectorAll(".chapter-check").forEach((box) => { box.checked = event.target.checked; });
  updateSelection();
});
$("#generate").addEventListener("click", generateAudiobook);
$("#cancel").addEventListener("click", () => state.controller?.abort());
$("#downloadZip").addEventListener("click", downloadZip);

async function loadEpub(file) {
  if (!file.name.toLowerCase().endsWith(".epub")) return toast("请选择 .epub 文件");
  try {
    toast("正在解析 EPUB…");
    const zip = await JSZip.loadAsync(file);
    const container = parseXml(await zip.file("META-INF/container.xml").async("text"));
    const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
    if (!opfPath || !zip.file(opfPath)) throw new Error("没有找到 EPUB 内容清单");
    const opf = parseXml(await zip.file(opfPath).async("text"));
    const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const title = nodeText(opf, "title") || file.name.replace(/\.epub$/i, "");
    const author = nodeText(opf, "creator") || "未知作者";
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
      chapters.push({ title: heading || `第 ${chapters.length + 1} 章`, text, selected: true });
    }
    if (!chapters.length) throw new Error("没有识别到可朗读章节");
    state.book = { title, author, filename: file.name };
    state.chapters = chapters;
    state.outputs.forEach((item) => URL.revokeObjectURL(item.url));
    state.outputs = [];
    renderBook();
    toast(`已识别 ${chapters.length} 个章节`);
  } catch (error) {
    console.error(error);
    toast(`解析失败：${error.message}`);
  }
}

function renderBook() {
  $("#bookTitle").textContent = state.book.title;
  $("#bookMeta").textContent = `${state.book.author} · ${state.chapters.length} 个章节`;
  chapterList.innerHTML = state.chapters.map((chapter, index) => `
    <div class="chapter">
      <input class="chapter-check" type="checkbox" data-index="${index}" checked />
      <div><div class="chapter-title">${escapeHtml(chapter.title)}</div><div class="chapter-meta">${chapter.text.length.toLocaleString()} 字符</div></div>
      <button class="chapter-preview" data-preview="${index}">预览文字</button>
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
  $("#selectedSummary").textContent = `已选择 ${selected.length}/${checks.length}`;
  $("#selectAll").checked = checks.length > 0 && selected.length === checks.length;
  $("#selectAll").indeterminate = selected.length > 0 && selected.length < checks.length;
  generateButton.disabled = selected.length === 0;
}

async function generateAudiobook() {
  const key = $("#apiKey").value.trim();
  if (!key) return toast("请先填写 API Key");
  const selectedIndexes = [...document.querySelectorAll(".chapter-check:checked")].map((box) => Number(box.dataset.index));
  if (!selectedIndexes.length) return toast("请至少选择一个章节");
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
      updateProgress(i, jobs.length, `${chapter.title}${job.partCount > 1 ? ` · 片段 ${job.partIndex + 1}/${job.partCount}` : ""}`);
      const blob = await synthesize(job.text, key, state.controller.signal);
      if (!pieces.has(job.chapterIndex)) pieces.set(job.chapterIndex, []);
      pieces.get(job.chapterIndex).push(blob);
    }
    for (const chapterIndex of selectedIndexes) {
      const chapter = state.chapters[chapterIndex];
      const blob = new Blob(pieces.get(chapterIndex), { type: "audio/mpeg" });
      state.outputs.push({ index: chapterIndex, title: chapter.title, blob, url: URL.createObjectURL(blob) });
    }
    updateProgress(jobs.length, jobs.length, "全部章节生成完成");
    renderResults();
  } catch (error) {
    if (error.name === "AbortError") toast("已停止生成");
    else { console.error(error); toast(`生成失败：${error.message}`); }
  } finally {
    setGenerating(false);
    state.controller = null;
  }
}

async function synthesize(input, key, signal) {
  const baseUrl = $("#baseUrl").value.trim().replace(/\/$/, "");
  const body = { model: $("#model").value.trim(), voice: $("#voice").value, input, response_format: "mp3" };
  const instructions = $("#instructions").value.trim();
  if (instructions) body.instructions = instructions;
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { const data = await response.json(); message = data.error?.message || message; } catch {}
    throw new Error(message);
  }
  return response.blob();
}

function renderResults() {
  $("#resultSummary").textContent = `已生成 ${state.outputs.length} 个章节，可以试听、单独下载或打包下载。`;
  $("#audioList").innerHTML = state.outputs.map((item, i) => `
    <div class="audio-item">
      <strong>${escapeHtml(item.title)}</strong>
      <audio controls src="${item.url}"></audio>
      <a href="${item.url}" download="${filename(i + 1, item.title)}.mp3">下载 MP3</a>
    </div>`).join("");
  $("#resultCard").classList.remove("hidden");
  $("#resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function downloadZip() {
  if (!state.outputs.length) return;
  toast("正在打包…");
  const zip = new JSZip();
  state.outputs.forEach((item, i) => zip.file(`${filename(i + 1, item.title)}.mp3`, item.blob));
  zip.file("README.txt", `${state.book.title}\n${state.book.author}\n\n由 SoundLeaf 生成。`);
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
  $("#progressTitle").textContent = done === total ? "生成完成" : "正在生成音频";
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
