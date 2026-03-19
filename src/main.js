import "./style.css";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const fileInput = document.getElementById("fileInput");
const chooseBtn = document.getElementById("chooseBtn");
const dropzone = document.getElementById("dropzone");
const preset = document.getElementById("preset");
const bitrateInput = document.getElementById("bitrate");
const customWrap = document.getElementById("customWrap");
const compressBtn = document.getElementById("compressBtn");
const resetBtn = document.getElementById("resetBtn");
const fileNameEl = document.getElementById("fileName");
const originalSizeEl = document.getElementById("originalSize");
const compressedSizeEl = document.getElementById("compressedSize");
const reductionEl = document.getElementById("reduction");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const logEl = document.getElementById("log");
const downloadLink = document.getElementById("downloadLink");

let ffmpeg = null;
let selectedFile = null;
let compressedBlobUrl = null;

function log(message) {
  logEl.textContent += `\n${message}`;
  logEl.scrollTop = logEl.scrollHeight;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let num = bytes;
  while (num >= 1024 && i < units.length - 1) {
    num /= 1024;
    i++;
  }
  return `${num.toFixed(num >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function setProgress(value, text) {
  const percent = Math.max(0, Math.min(100, value));
  progressBar.style.width = `${percent}%`;
  progressText.textContent = text || `${percent.toFixed(0)}%`;
}

function setSelectedFile(file) {
  selectedFile = file;
  fileNameEl.textContent = file ? file.name : "None";
  originalSizeEl.textContent = file ? formatBytes(file.size) : "-";
  compressedSizeEl.textContent = "-";
  reductionEl.textContent = "-";
  compressBtn.disabled = !file;
  downloadLink.style.display = "none";

  if (compressedBlobUrl) {
    URL.revokeObjectURL(compressedBlobUrl);
    compressedBlobUrl = null;
  }

  if (file) {
    log(`Selected file: ${file.name} (${formatBytes(file.size)})`);
  }
}

async function ensureFFmpegLoaded() {
  if (ffmpeg) return ffmpeg;

  log("Loading FFmpeg core...");
  setProgress(5, "Loading FFmpeg...");

  ffmpeg = new FFmpeg();

  ffmpeg.on("log", ({ message }) => {
    if (message && /time=|Duration:|video:/i.test(message)) {
      log(message);
    }
  });

  ffmpeg.on("progress", ({ progress }) => {
    const pct = 10 + progress * 85;
    setProgress(pct, `Compressing... ${Math.round(progress * 100)}%`);
  });

  await ffmpeg.load({
    coreURL: await toBlobURL("/ffmpeg-core/ffmpeg-core.js", "text/javascript"),
    wasmURL: await toBlobURL("/ffmpeg-core/ffmpeg-core.wasm", "application/wasm"),
  });

  log("FFmpeg loaded.");
  setProgress(10, "FFmpeg ready");
  return ffmpeg;
}

function getPresetOptions() {
  const mode = preset.value;

  if (mode === "light") {
    return { scale: "1280:-2", bitrate: "2200k", audio: "128k" };
  }

  if (mode === "strong") {
    return { scale: "854:-2", bitrate: "950k", audio: "96k" };
  }

  if (mode === "custom") {
    const kbps = Math.max(250, Number(bitrateInput.value || 1800));
    return { scale: "1280:-2", bitrate: `${kbps}k`, audio: "96k" };
  }

  return { scale: "1280:-2", bitrate: "1500k", audio: "128k" };
}

async function compressVideo() {
  if (!selectedFile) return;

  compressBtn.disabled = true;
  chooseBtn.disabled = true;
  fileInput.disabled = true;
  preset.disabled = true;
  bitrateInput.disabled = true;

  try {
    await ensureFFmpegLoaded();

    log("Preparing file...");
    setProgress(12, "Preparing file...");

    const inputName = "input-video";
    const outputName = "compressed-output.mp4";
    const ext = (selectedFile.name.split(".").pop() || "").toLowerCase();
    const finalInputName = ext ? `${inputName}.${ext}` : inputName;

    await ffmpeg.writeFile(finalInputName, await fetchFile(selectedFile));

    const opts = getPresetOptions();
    log(`Using preset: ${preset.value}, bitrate ${opts.bitrate}, audio ${opts.audio}, scale ${opts.scale}`);

    await ffmpeg.exec([
      "-i", finalInputName,
      "-vf", `scale=${opts.scale}`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-b:v", opts.bitrate,
      "-maxrate", opts.bitrate,
      "-bufsize", "2M",
      "-c:a", "aac",
      "-b:a", opts.audio,
      "-movflags", "+faststart",
      "-pix_fmt", "yuv420p",
      "-y",
      outputName
    ]);

    setProgress(97, "Finalizing...");
    log("Reading compressed file...");

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    compressedBlobUrl = URL.createObjectURL(blob);

    downloadLink.href = compressedBlobUrl;
    downloadLink.download = `${selectedFile.name.replace(/\.[^.]+$/, "") || "video"}-compressed.mp4`;
    downloadLink.style.display = "inline-flex";

    compressedSizeEl.textContent = formatBytes(blob.size);
    const saved = selectedFile.size - blob.size;
    const reduction = selectedFile.size > 0
      ? `${((saved / selectedFile.size) * 100).toFixed(1)}%`
      : "-";
    reductionEl.textContent = reduction;

    setProgress(100, "Done");
    log(`Compression done. Output size: ${formatBytes(blob.size)}. Saved: ${formatBytes(saved > 0 ? saved : 0)}.`);
  } catch (error) {
    console.error(error);
    log(`Error: ${error.message || error}`);
    setProgress(0, "Failed");
    alert("Compression failed. Check the activity log for details.");
  } finally {
    compressBtn.disabled = !selectedFile;
    chooseBtn.disabled = false;
    fileInput.disabled = false;
    preset.disabled = false;
    bitrateInput.disabled = false;
  }
}

chooseBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) setSelectedFile(file);
});

preset.addEventListener("change", () => {
  customWrap.style.display = preset.value === "custom" ? "block" : "block";
  if (preset.value !== "custom") customWrap.style.display = "none";
});

compressBtn.addEventListener("click", compressVideo);

resetBtn.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileNameEl.textContent = "None";
  originalSizeEl.textContent = "-";
  compressedSizeEl.textContent = "-";
  reductionEl.textContent = "-";
  progressBar.style.width = "0%";
  progressText.textContent = "Idle";
  logEl.textContent = "Ready.";
  downloadLink.style.display = "none";
  compressBtn.disabled = true;

  if (compressedBlobUrl) {
    URL.revokeObjectURL(compressedBlobUrl);
    compressedBlobUrl = null;
  }
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove("drag");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("video/")) {
    setSelectedFile(file);
  } else {
    alert("Please drop a valid video file.");
  }
});