/* image-forensics site. No dependencies.
 * Set API_BASE to the deployed scoring service (e.g. the HF Space URL) to enable live analysis. */

"use strict";

const API_BASE = ""; // "" = same origin; or e.g. "https://<space>.hf.space"

let apiUp = false;

async function probeApi(timeoutMs) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 4000);
    const r = await fetch(API_BASE + "/health", { signal: ctl.signal });
    clearTimeout(t);
    apiUp = r.ok;
  } catch { apiUp = false; }
  if (apiUp) setState("ready · live");
  return apiUp;
}
probeApi(4000);

/* analyzer */

const body = document.getElementById("analyzer-body");
const stateChip = document.getElementById("analyzer-state");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const STAGES = [
  "decode image",
  "center-crop 512 px · JPEG q75 substrate",
  "luma transform (BT.601)",
  "decoder-grid features · 18",
  "sensor-physics features · 2",
  "inversion-residual features · 2",
  "self-consistency features · 5",
  "google-family spectral panel",
  "provenance metadata scan",
  "score against real-photo reference",
];

let samplesCache = null;
async function loadSamples() {
  if (!samplesCache) {
    const res = await fetch("assets/samples.json");
    samplesCache = await res.json();
  }
  return samplesCache;
}

const SAMPLE_META = {
  firefly: { name: "Adobe Firefly — factory floor scene", img: "assets/sample-firefly.jpg" },
  nano: { name: "Google nano-banana — genuine output", img: "assets/sample-nano.jpg" },
};

function setState(text) { stateChip.textContent = text; }

function resetAnalyzer() {
  body.innerHTML = "";
  body.appendChild(dropzoneTemplate());
  body.appendChild(adviceTemplate());
  body.appendChild(samplesTemplate());
  setState("ready");
}

function adviceTemplate() {
  const p = document.createElement("p");
  p.className = "analyzer__note";
  p.textContent = "* dragged images are often resized and re-compressed by the site serving them. " +
    "For the most reliable verdict, download the original image and upload the file.";
  return p;
}

function dropzoneTemplate() {
  const label = document.createElement("label");
  label.className = "dropzone";
  label.id = "dropzone";
  label.innerHTML = `
    <span class="dropzone__mark" aria-hidden="true"></span>
    <span>Drop an image, or browse</span>
    <span class="dropzone__hint">JPEG · PNG · WebP — short side ≥ 512 px<br>drag one straight from another website, too*</span>`;
  const input = document.createElement("input");
  input.type = "file";
  input.id = "file-input";
  input.accept = "image/jpeg,image/png,image/webp";
  input.addEventListener("change", () => { if (input.files[0]) handleFile(input.files[0]); });
  label.appendChild(input);
  wireDrag(label);
  return label;
}

function samplesTemplate() {
  const div = document.createElement("div");
  div.className = "samples";
  div.innerHTML = `<span class="label">demo — real reports from real AI images:</span>`;
  for (const key of ["firefly", "nano"]) {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.sample = key;
    b.textContent = key === "firefly" ? "Demo · Adobe Firefly" : "Demo · Google nano-banana";
    div.appendChild(b);
  }
  return div;
}

function wireDrag(zone) {
  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.add("is-drag");
  }));
  ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.remove("is-drag");
  }));
  zone.addEventListener("drop", e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { handleFile(f); return; }
    const url = extractDragUrl(e.dataTransfer);
    if (url) handleUrl(url);
  });
}

wireDrag(dropzone);
fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

document.addEventListener("click", (e) => {
  const nb = e.target.closest("#nav-analyze");
  if (nb) {
    e.preventDefault();
    const card = document.getElementById("analyze");
    const r = card.getBoundingClientRect();
    const visible = r.top < innerHeight * 0.8 && r.bottom > 120;
    if (!visible) card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    if (!body.querySelector(".dropzone")) resetAnalyzer();
    const inp = body.querySelector('input[type="file"]');
    if (inp) inp.click();
    return;
  }
  const b = e.target.closest("[data-sample]");
  if (b) { runSample(b.dataset.sample); return; }
  const a = e.target.closest('a[href^="#"]');
  if (a) {
    const el = document.querySelector(a.getAttribute("href"));
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }
  }
});

function extractDragUrl(dt) {
  let u = (dt.getData("text/uri-list") || "").split("\n").find(l => l && !l.startsWith("#")) || "";
  if (!u) {
    const htmlStr = dt.getData("text/html");
    const m = htmlStr && htmlStr.match(/<img[^>]+src="([^"]+)"/i);
    if (m) u = m[1].replace(/&amp;/g, "&");
  }
  if (!u) u = dt.getData("text/plain") || "";
  return /^https?:\/\//.test(u) ? u : null;
}

async function handleUrl(url) {
  if (!apiUp) await probeApi(6000);
  if (!apiUp) {
    showNotice("Dragging an image from another website needs the scoring service, which " +
      "isn\u2019t connected right now. Save the image and upload the file, or load a demo report.", true);
    return;
  }
  setState("measuring\u2026");
  body.innerHTML = "";
  const runlog = runlogTemplate(null);
  body.appendChild(runlog);
  const stages = animateStages(runlog, { stepMs: 320 });
  const setPreview = (b64) => {
    if (!b64) return;
    const prev = runlog.querySelector(".runlog__preview");
    if (!prev) return;
    const img = new Image();
    img.src = "data:image/jpeg;base64," + b64;
    img.onload = async () => {
      try { prev.prepend(cropAndLuma(await createImageBitmap(img))); }
      catch { img.alt = "The 512 px analyzed crop"; prev.prepend(img); }
    };
  };
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120000);
    const [res] = await Promise.all([
      fetch(API_BASE + "/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: abort.signal,
      }),
      stages.play(),
    ]);
    clearTimeout(timer);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(d && d.detail ? d.detail : "HTTP " + res.status);
    }
    const report = await res.json();
    setPreview(report.substrate_b64);
    stages.finish();
    renderReport(report, { name: url });
  } catch (err) {
    setState("ready");
    showNotice("The image couldn\u2019t be analyzed from that site (" + err.message + ") " +
      "\u2014 some sites block downloads. Save the image and upload the file instead.", true);
    body.appendChild(samplesTemplate());
  }
}

/* client-side mirror of the real preprocessing: center-crop + BT.601 luma */
function cropAndLuma(imgBitmap) {
  const size = Math.min(imgBitmap.width, imgBitmap.height, 512);
  const sx = (imgBitmap.width - size) / 2;
  const sy = (imgBitmap.height - size) / 2;
  const c = document.createElement("canvas");
  c.width = 192; c.height = 192;
  const ctx = c.getContext("2d");
  ctx.drawImage(imgBitmap, sx, sy, size, size, 0, 0, 192, 192);
  const px = ctx.getImageData(0, 0, 192, 192);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(px, 0, 0);
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", "The 512 px center crop in luminance — exactly what the model reads");
  return c;
}

function runlogTemplate(previewEl) {
  const wrap = document.createElement("div");
  wrap.className = "runlog";
  const prev = document.createElement("div");
  prev.className = "runlog__preview";
  if (previewEl) prev.appendChild(previewEl);
  const scan = document.createElement("div");
  scan.className = "runlog__scan";
  scan.setAttribute("aria-hidden", "true");
  prev.appendChild(scan);
  const ol = document.createElement("ol");
  ol.className = "runlog__lines";
  STAGES.forEach(s => {
    const li = document.createElement("li");
    li.textContent = s;
    ol.appendChild(li);
  });
  wrap.appendChild(prev);
  wrap.appendChild(ol);
  return wrap;
}

function animateStages(runlog, opts) {
  const lines = [...runlog.querySelectorAll("li")];
  const stepMs = reduceMotion ? 0 : (opts && opts.stepMs) || 320;
  const upTo = (opts && opts.upTo) || lines.length; // stages that actually run
  const stopScan = () => {
    const scan = runlog.querySelector(".runlog__scan");
    if (scan) scan.remove();
  };
  let i = 0;
  return {
    // advances stage-by-stage; resolves when all but the last stage are done
    play() {
      return new Promise(resolve => {
        const tick = () => {
          if (i > 0) { lines[i - 1].classList.remove("is-live"); lines[i - 1].classList.add("is-done"); }
          if (i >= upTo) {
            if (upTo < lines.length) {
              lines.slice(upTo).forEach(l => l.classList.add("is-skip"));
              stopScan();
            } else {
              lines[lines.length - 1].classList.remove("is-done");
              lines[lines.length - 1].classList.add("is-live");
            }
            resolve(); return;
          }
          lines[i].classList.add("is-live");
          i += 1;
          stepMs ? setTimeout(tick, stepMs) : tick();
        };
        tick();
      });
    },
    finish() {
      lines.forEach(l => { l.classList.remove("is-live", "is-skip"); l.classList.add("is-done"); });
      stopScan();
    },
  };
}

async function handleFile(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    showNotice("That file type isn’t supported. The pipeline reads JPEG, PNG and WebP.", true);
    return;
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    showNotice("The image couldn’t be decoded. Try re-saving it as JPEG or PNG.", true);
    return;
  }
  if (Math.min(bitmap.width, bitmap.height) < 512) {
    showNotice(`This image is ${bitmap.width} × ${bitmap.height}. The short side must be at least 512 px — ` +
      "the model never upscales, because upscaling destroys the statistics it measures.", true);
    return;
  }

  setState("measuring…");
  body.innerHTML = "";
  const canvas = cropAndLuma(bitmap);
  const runlog = runlogTemplate(canvas);
  body.appendChild(runlog);
  if (!apiUp) await probeApi(6000);
  const stages = animateStages(runlog, apiUp ? { stepMs: 320 } : { stepMs: 320, upTo: 3 });

  if (!apiUp) {
    await stages.play();
    setState("ready");
    showNotice(
      "Preprocessing done \u2014 the preview is exactly what the model reads: the 512 px center crop, " +
      "in luminance. The 27 measurements and the scoring run server-side, and the scoring service " +
      "isn\u2019t connected yet. Run the pipeline locally from the GitHub repo, or load a demo " +
      "report below to see a real verdict.", false);
    body.appendChild(samplesTemplate());
    return;
  }

  try {
    const fd = new FormData();
    fd.append("image", file);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120000);
    const [res] = await Promise.all([
      fetch(API_BASE + "/analyze", { method: "POST", body: fd, signal: abort.signal }),
      stages.play(),
    ]);
    clearTimeout(timer);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const report = await res.json();
    stages.finish();
    renderReport(report, { name: file.name, img: canvas.toDataURL("image/jpeg", 0.8) });
  } catch (err) {
    setState("error");
    showNotice("The analysis request failed (" + err.message + "). " +
      "The service may be waking up — try again in a few seconds.", true);
    body.appendChild(samplesTemplate());
  }
}

async function runSample(key) {
  const meta = SAMPLE_META[key];
  if (!meta) return;
  const card = document.getElementById("analyze");
  if (card) card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  setState("measuring…");
  body.innerHTML = "";
  let previewEl;
  try {
    const bmp = await createImageBitmap(await (await fetch(meta.img)).blob());
    previewEl = cropAndLuma(bmp);
  } catch {
    previewEl = document.createElement("img");
    previewEl.src = meta.img;
    previewEl.alt = "The 512 px analyzed crop of this sample";
  }
  const runlog = runlogTemplate(previewEl);
  body.appendChild(runlog);
  const stages = animateStages(runlog, { stepMs: 200 });
  const [samples] = await Promise.all([loadSamples(), stages.play()]);
  stages.finish();
  const report = { ...samples[key] };
  if (!report.substrate_b64) {
    try { report.substrate_b64 = await blobToB64(await (await fetch(meta.img)).blob()); }
    catch { /* PDF simply omits the preview */ }
  }
  renderReport(report, { name: meta.name, img: meta.img, sample: true });
}

function showNotice(text, isError) {
  const existing = body.querySelector(".notice");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.className = "notice" + (isError ? " notice--error" : "");
  div.textContent = text;
  if (isError) { setState("ready"); }
  body.appendChild(div);
  return div;
}

function verdictClass(v) {
  if (v === "LIKELY AI-GENERATED") return "verdict__chip--ai";
  if (v === "LEANING AI-GENERATED") return "verdict__chip--lean";
  if (v === "LIKELY REAL") return "verdict__chip--real";
  return "verdict__chip--inc";
}

function renderReport(r, source) {
  if (!r || typeof r.score_z !== "number" && typeof r.score_z !== "string" || r.verdict === "UNSUPPORTED" || r.verdict === "ERROR") {
    setState("ready");
    showNotice("The pipeline couldn\u2019t score this image" +
      (r && r.verdict === "UNSUPPORTED" ? " \u2014 it doesn\u2019t meet the 512 px minimum after decoding." : ".") +
      " Try another image, or load a demo report.", true);
    body.appendChild(samplesTemplate());
    return;
  }
  setState("done");
  body.innerHTML = "";

  const rep = document.createElement("div");
  rep.className = "report";

  if (source && source.sample) {
    const tag = document.createElement("p");
    tag.className = "report__meta";
    tag.textContent = "example — a real report produced by this pipeline on a known AI image (" + source.name + ")";
    rep.appendChild(tag);
  }

  const verdict = document.createElement("div");
  verdict.className = "verdict";
  const chip = document.createElement("span");
  chip.className = "verdict__chip " + verdictClass(r.verdict);
  chip.textContent = r.verdict;
  const z = document.createElement("span");
  z.className = "verdict__z tnum";
  z.textContent = "score z = " + Number(r.score_z).toFixed(3) + " · crops: " + r.n_crops +
    (r.input_size ? " · " + r.input_size.replace("x", " × ") + " px" : "");
  verdict.appendChild(chip);
  verdict.appendChild(z);
  rep.appendChild(verdict);
  const wmHit = r.watermark && r.watermark.found && r.watermark.found.length;
  if (wmHit) {
    const basis = document.createElement("p");
    basis.className = "verdict__basis";
    basis.textContent = "Verdict set by a visible watermark (" + r.watermark.found[0].mark +
      "). The scale below reflects pixel statistics only.";
    rep.appendChild(basis);
  }

  const pct = Math.max(0, Math.min(100, Number(r.real_percentile)));
  const scale = document.createElement("div");
  scale.className = "scale";
  scale.innerHTML = `
    <div class="scale__track" role="img"></div>
    <div class="scale__bands"><span>real ≤ 30</span><span>inconclusive</span><span>leaning ≥ 80 · AI ≥ 95</span></div>`;
  scale.querySelector(".scale__track").setAttribute("aria-label",
    "Real-photo percentile scale: this image sits at the " + pct.toFixed(1) + "th percentile");
  const marker = document.createElement("div");
  marker.className = "scale__marker";
  marker.style.left = pct + "%";
  scale.querySelector(".scale__track").appendChild(marker);
  rep.appendChild(scale);

  const strength = document.createElement("p");
  strength.className = "report__strength";
  strength.textContent = r.strength_text;
  rep.appendChild(strength);

  const panels = document.createElement("ul");
  panels.className = "panels";
  (r.panels || []).forEach(p => {
    const li = document.createElement("li");
    const h = document.createElement("h4");
    h.textContent = p.title;
    const zv = document.createElement("span");
    zv.className = "verdict__z tnum z";
    zv.textContent = "z " + Number(p.z).toFixed(2);
    const sig = document.createElement("span");
    sig.className = "sig" + (p.signal === "strong" ? " sig--strong" : p.signal === "moderate" ? " sig--moderate" : "");
    sig.textContent = p.signal;
    const ex = document.createElement("p");
    ex.className = "explain";
    ex.textContent = p.explanation;
    li.append(h, zv, sig, ex);
    panels.appendChild(li);
  });
  rep.appendChild(panels);

  if (r.watermark) {
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    const hits = r.watermark.found || [];
    sum.textContent = "visible watermark — " + (hits.length ? "found" : "none");
    if (hits.length) { det.open = true; sum.classList.add("wm-found"); }
    const p = document.createElement("p");
    if (hits.length) {
      const h = hits[0];
      p.textContent = "A mark matching the " + h.mark + " was found at its documented position (" +
        h.corner + "), correlation " + Number(h.score).toFixed(3) + " against a threshold of " +
        Number(h.threshold).toFixed(3) + ". A visible watermark is strong evidence the image came from " +
        h.generator + ". Absence of a watermark never means an image is real: APIs and paid tiers do not stamp.";
    } else {
      p.textContent = "No known generator watermark at its documented position (checked: " +
        (r.watermark.checked || []).join(", ") + "). This means nothing on its own: most AI images " +
        "come from APIs and paid tiers that never stamp, and visible marks can be cropped away.";
    }
    det.append(sum, p);
    rep.appendChild(det);
  }

  if (r.provenance) {
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "provenance metadata — " + r.provenance.verdict;
    const p = document.createElement("p");
    p.textContent = r.provenance.detail + " Checked: " + (r.provenance.checked || []).join(", ") + ".";
    det.append(sum, p);
    rep.appendChild(det);
  }

  if (r.limitations) {
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "limitations";
    const p = document.createElement("p");
    p.textContent = r.limitations;
    det.append(sum, p);
    rep.appendChild(det);
  }

  const actions = document.createElement("div");
  actions.className = "report__actions";
  const dl = document.createElement("button");
  dl.className = "btn btn--outline";
  dl.textContent = "Download report (PDF)";
  dl.addEventListener("click", () => downloadPdf(r, source, dl));
  const dlj = document.createElement("button");
  dlj.className = "btn btn--ghost";
  dlj.textContent = "JSON";
  dlj.addEventListener("click", () => downloadReport(r, source));
  const again = document.createElement("button");
  again.className = "btn btn--ghost";
  again.textContent = "Analyze another image";
  again.addEventListener("click", resetAnalyzer);
  actions.append(dl, dlj, again);
  rep.appendChild(actions);

  body.appendChild(rep);
}

function blobToB64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

async function downloadPdf(r, source, btn) {
  if (!apiUp) { downloadReport(r, source); return; }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing PDF…";
  try {
    const res = await fetch(API_BASE + "/report-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "forensics-report.pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    downloadReport(r, source);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function downloadReport(r, source) {
  const { substrate_b64, ...clean } = r;
  const payload = {
    tool: "image-forensics — white-box AI-image detector",
    source: "https://github.com/Merlin2k-dev/ai-image-forensics",
    generated: new Date().toISOString(),
    input: source ? source.name : "uploaded image",
    report: clean,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "forensics-report.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* spectral field - sparse frequency-domain peaks drifting behind the page */

(function () {
  const canvas = document.getElementById("spectral");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  ctx.fillStyle = accent;
  if (ctx.fillStyle === "#000000") accent = "#6f8dff";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0, pts = [];

  function size() {
    W = canvas.offsetWidth; H = canvas.offsetHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.min(110, Math.floor((W * H) / 16000));
    while (pts.length < target) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.06 + Math.random() * 0.14;
      pts.push({ x: Math.random() * W, y: Math.random() * H,
                 vx: Math.cos(a) * v, vy: Math.sin(a) * v });
    }
    pts.length = target;
  }

  function draw(move) {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    for (const p of pts) {
      if (move) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -4) p.x = W + 4; else if (p.x > W + 4) p.x = -4;
        if (p.y < -4) p.y = H + 4; else if (p.y > H + 4) p.y = -4;
      }
      ctx.globalAlpha = 0.55;
      ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 12100) {
          ctx.globalAlpha = (1 - Math.sqrt(d2) / 110) * 0.17;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  size();
  new ResizeObserver(size).observe(canvas);
  if (reduceMotion) { draw(false); return; }
  let running = true;
  document.addEventListener("visibilitychange", () => { running = !document.hidden; });
  (function loop() {
    if (running) draw(true);
    requestAnimationFrame(loop);
  })();
})();

/* footer banner: tap/keyboard toggle for non-hover devices */
(function () {
  const el = document.getElementById("foot-flip");
  if (!el) return;
  const toggle = () => {
    el.classList.toggle("is-flipped");
    el.setAttribute("aria-pressed", String(el.classList.contains("is-flipped")));
  };
  el.addEventListener("click", toggle);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  });
})();
