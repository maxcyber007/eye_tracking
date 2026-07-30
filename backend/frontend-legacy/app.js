/**
 * Web client for the Alzheimer eye-tracking risk prototype.
 *
 * Flow: intro -> setup (camera) -> task (pursuit + recording) -> processing
 *       (upload) -> result. The stimulus position is logged on every animation
 *       frame against the recording's own time origin, which is what lets the
 *       backend compute `tracking_error` against the real target path instead
 *       of falling back to its self-consistency proxy.
 *
 * Two modes, selected by the `mode` query parameter:
 *
 *   (default)        participant mode - posts to /api/predict and shows a score.
 *   ?mode=research   researcher mode  - requires a label, posts to /api/upload so
 *                    the sample joins dataset.csv, and exposes dataset status plus
 *                    a training button. The label field is deliberately hidden in
 *                    participant mode: a participant must never be asked to
 *                    classify themselves.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /** โหมดนักวิจัยเปิดด้วย ?mode=research บน URL */
  const RESEARCH_MODE = new URLSearchParams(location.search).get("mode") === "research";

  // ─── สถานะของแอป ────────────────────────────────────────────────────────
  const state = {
    stream: null,
    recorder: null,
    chunks: [],
    trajectory: [],
    rafId: 0,
    startedAt: 0,
    running: false,
    aborted: false,
    settings: { subjectId: "", duration: 30, pattern: "horizontal", apiBase: "", label: "" },
  };

  /** ชื่อและหน่วยของ feature สำหรับแสดงผลให้คนอ่านเข้าใจ */
  const FEATURE_LABELS = {
    eye_velocity: ["ความเร็วเฉลี่ยของสายตา", "หน่วยตา/วินาที"],
    eye_acceleration: ["ความเร่งเฉลี่ย", "หน่วยตา/วินาที²"],
    eye_distance: ["ระยะห่างระหว่างตา", "สัดส่วนของความกว้างภาพ"],
    movement_smoothness: ["ความราบรื่นของการเคลื่อนไหว", "ค่าสูง (ติดลบน้อย) = ราบรื่นกว่า"],
    blink_rate: ["อัตราการกะพริบตา", "ครั้ง/นาที"],
    fixation_time: ["เวลาที่จ้องนิ่ง", "วินาที"],
    total_distance: ["ระยะทางรวมที่สายตาเคลื่อนที่", "หน่วยตา"],
    average_velocity: ["ความเร็วเฉลี่ยตลอดการทดสอบ", "หน่วยตา/วินาที"],
    max_velocity: ["ความเร็วสูงสุด", "หน่วยตา/วินาที"],
    tracking_error: ["ความคลาดเคลื่อนจากเป้าหมาย", "ค่าต่ำ = ตามได้แม่นกว่า"],
  };

  /** คำแนะนำเฉพาะสำหรับ error แต่ละชนิดที่ backend นิยามไว้ */
  const ERROR_HINTS = {
    ModelNotTrainedError:
      "ยังไม่มีโมเดลบนเซิร์ฟเวอร์ ผู้ดูแลระบบต้องสร้างชุดข้อมูลแล้วเรียก POST /api/train ก่อน " +
      "ดูขั้นตอนได้ใน backend/README.md",
    NoFaceDetectedError:
      "ระบบตรวจไม่พบใบหน้าในหลายเฟรม ลองย้ายไปที่ที่สว่างขึ้น ไม่ย้อนแสง " +
      "และจัดให้ใบหน้าอยู่เต็มกรอบตลอดการทดสอบ",
    InvalidVideoError:
      "ไฟล์วิดีโอไม่ผ่านการตรวจสอบ อาจมีขนาดใหญ่เกินไปหรือสกุลไฟล์ไม่รองรับ ลองลดระยะเวลาการทดสอบ",
    VideoProcessingError:
      "เซิร์ฟเวอร์ถอดรหัสวิดีโอไม่ได้ อาจเป็นเพราะ codec ที่เบราว์เซอร์นี้ใช้ ลองเบราว์เซอร์อื่น",
    FeatureExtractionError:
      "การบันทึกสั้นเกินไปจนคำนวณค่าไม่ได้ ลองตั้งระยะเวลาอย่างน้อย 15 วินาที",
  };

  // ─── การสลับหน้าจอ ──────────────────────────────────────────────────────
  /**
   * แสดงหน้าจอที่ระบุและซ่อนหน้าอื่นทั้งหมด
   * @param {string} name ชื่อหน้าจอ เช่น "intro"
   */
  function show(name) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
    $("screen-" + name).classList.add("active");
    window.scrollTo(0, 0);
  }

  // ─── การเรียก API ───────────────────────────────────────────────────────
  /**
   * ประกอบ URL ของ API โดยยึดเซิร์ฟเวอร์เดียวกันเป็นค่าเริ่มต้น
   * @param {string} path เส้นทาง เช่น "/api/predict"
   * @returns {string} URL เต็ม
   */
  function apiUrl(path) {
    const base = (state.settings.apiBase || "").replace(/\/+$/, "");
    return base ? base + path : path;
  }

  /**
   * ส่งวิดีโอไป backend พร้อมรายงานความคืบหน้าการอัปโหลด
   *
   * โหมดนักวิจัยยิงไป /api/upload พร้อม label เพื่อให้ตัวอย่างถูกต่อท้าย
   * dataset.csv ส่วนโหมดผู้เข้าร่วมยิงไป /api/predict ซึ่งไม่แตะชุดข้อมูล
   *
   * @param {Blob} blob ไฟล์วิดีโอที่บันทึกได้
   * @param {string} extension นามสกุลไฟล์ที่เหมาะกับ MIME type
   * @param {(ratio:number)=>void} onProgress callback รับค่า 0–1
   * @returns {Promise<object>} payload จาก backend
   */
  function uploadRecording(blob, extension, onProgress) {
    const form = new FormData();
    form.append("file", blob, `recording.${extension}`);
    form.append("target_trajectory", JSON.stringify(state.trajectory));
    if (state.settings.subjectId) form.append("subject_id", state.settings.subjectId);

    const endpoint = RESEARCH_MODE ? "/api/upload" : "/api/predict";
    if (RESEARCH_MODE) form.append("label", state.settings.label);

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", apiUrl(endpoint));
      request.timeout = 300000;

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      };
      request.onload = () => {
        let body;
        try {
          body = JSON.parse(request.responseText);
        } catch {
          reject({ error: "ParseError", message: `เซิร์ฟเวอร์ตอบกลับในรูปแบบที่อ่านไม่ได้ (HTTP ${request.status})` });
          return;
        }
        if (request.status >= 200 && request.status < 300) resolve(body);
        else reject(body);
      };
      request.onerror = () =>
        reject({ error: "NetworkError", message: "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่า backend ทำงานอยู่" });
      request.ontimeout = () =>
        reject({ error: "TimeoutError", message: "เซิร์ฟเวอร์ใช้เวลานานเกินไป ลองลดระยะเวลาการทดสอบ" });

      request.send(form);
    });
  }

  // ─── โหมดนักวิจัย: สถานะชุดข้อมูลและการเทรน ─────────────────────────────
  /**
   * ส่งผู้ใช้ไปหน้าเข้าสู่ระบบ เมื่อ backend ตอบ 401
   *
   * โหมดนักวิจัยต้องล็อกอิน เพราะทั้งการเขียน dataset และการอ่านผลย้อนหลัง
   * เป็นข้อมูลของผู้เข้าร่วมหลายคน
   *
   * @returns {void}
   */
  function requireLogin() {
    const target = encodeURIComponent(location.pathname + location.search);
    location.href = `dashboard.html?next=${target}`;
  }

  /**
   * ดึงสถานะชุดข้อมูลและโมเดลจาก GET /api/train/status แล้วแสดงบนแผงควบคุม
   * @returns {Promise<void>}
   */
  async function loadTrainStatus() {
    const stats = $("datasetStats");
    const trainButton = $("btnTrain");
    stats.innerHTML = '<div><span>สถานะ</span><b>กำลังโหลด…</b></div>';
    trainButton.disabled = true;

    try {
      const response = await fetch(apiUrl("/api/train/status"));
      if (response.status === 401) {
        requireLogin();
        return;
      }
      const body = await response.json();
      const dataset = body.dataset || {};
      const model = body.model || {};
      const counts = dataset.label_counts || {};
      const control = Number(counts["0"] || 0);
      const atRisk = Number(counts["1"] || 0);

      // ต้องมีอย่างน้อย 2 ตัวอย่างต่อกลุ่ม จึงจะแบ่ง train/test แบบ stratified ได้
      const ready = control >= 2 && atRisk >= 2;

      stats.innerHTML = [
        ["ตัวอย่างทั้งหมด", dataset.rows || 0, ""],
        ["โมเดลปัจจุบัน", model.available ? model.model_type : "ยังไม่มี", model.available ? "level-Low" : "level-Moderate"],
        ["กลุ่มควบคุม (0)", control, control >= 2 ? "level-Low" : "level-High"],
        ["กลุ่มเสี่ยง (1)", atRisk, atRisk >= 2 ? "level-Low" : "level-High"],
      ]
        .map(([label, value, cls]) => `<div><span>${label}</span><b class="${cls}">${value}</b></div>`)
        .join("");

      trainButton.disabled = !ready;
      trainButton.textContent = ready
        ? "เทรนโมเดล"
        : "ต้องมีอย่างน้อย 2 ตัวอย่างในแต่ละกลุ่ม";

      if (model.available && model.metrics) renderTrainMetrics(model.metrics, false);
    } catch {
      stats.innerHTML = '<div><span>สถานะ</span><b class="level-High">ติดต่อเซิร์ฟเวอร์ไม่ได้</b></div>';
    }
  }

  /**
   * เรียก POST /api/train แล้วแสดงผลการเทรน
   * @returns {Promise<void>}
   */
  async function trainModel() {
    const button = $("btnTrain");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "กำลังเทรน…";

    try {
      const response = await fetch(apiUrl("/api/train"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok) {
        $("trainResult").hidden = false;
        $("trainResult").innerHTML =
          `<div class="train-error">เทรนไม่สำเร็จ — ${body.message || body.error || "ไม่ทราบสาเหตุ"}</div>`;
        return;
      }
      // รีเฟรชสถานะก่อน แล้วค่อยเขียนทับด้วยผลของรอบที่เพิ่งเทรน
      await loadTrainStatus();
      renderTrainMetrics(body.metrics, true);
    } catch (err) {
      $("trainResult").hidden = false;
      $("trainResult").innerHTML = `<div class="train-error">ติดต่อเซิร์ฟเวอร์ไม่ได้: ${err.message}</div>`;
    } finally {
      button.textContent = original;
      button.disabled = false;
    }
  }

  /**
   * แสดงตัวชี้วัดของโมเดล
   * @param {object} metrics ตัวชี้วัดจาก /api/train หรือจาก metadata ของโมเดลที่โหลดอยู่
   * @param {boolean} justTrained เพิ่งเทรนเสร็จหรือเป็นการแสดงผลของโมเดลเดิม
   */
  function renderTrainMetrics(metrics, justTrained) {
    if (!metrics || metrics.accuracy === undefined) return;
    const box = $("trainResult");
    box.hidden = false;
    const rows = [
      ["Accuracy", metrics.accuracy],
      ["F1", metrics.f1_score],
      ["Precision", metrics.precision],
      ["Recall", metrics.recall],
      ["ROC AUC", metrics.roc_auc],
      ["CV accuracy", metrics.cv_mean_accuracy],
    ]
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([label, value]) => `<div><span>${label}</span><b>${Number(value).toFixed(3)}</b></div>`)
      .join("");

    // ชุดทดสอบเล็กมากทำให้ตัวเลขแกว่งจนตีความไม่ได้ ต้องเตือนให้ชัด
    const tiny = Number(metrics.test_samples) < 10;
    const tinyWarning = tiny
      ? `<p class="train-note warn-note">ชุดทดสอบมีเพียง ${metrics.test_samples} ตัวอย่าง
         ตัวเลขข้างบนจึงยังไม่มีความหมายทางสถิติ ใช้ยืนยันได้แค่ว่าระบบเทรนผ่านเท่านั้น</p>`
      : "";

    box.innerHTML = `
      <div class="train-head">${justTrained ? "เทรนสำเร็จ" : "โมเดลที่ใช้อยู่"} —
        ${metrics.train_samples} train / ${metrics.test_samples} test</div>
      <div class="quality metrics">${rows}</div>
      ${tinyWarning}
      <p class="train-note">ตัวเลขนี้วัดจากการแบ่งข้อมูลแบบสุ่ม ไม่ได้แบ่งตามผู้เข้าร่วม
        ถ้ามีหลายคลิปต่อคน ค่าที่เห็นจะสูงกว่าความเป็นจริง</p>`;
  }

  // ─── เส้นทางของลูกบอล ───────────────────────────────────────────────────
  /**
   * คำนวณตำแหน่งลูกบอลในพิกัด 0–1 ตามสัดส่วนความคืบหน้า
   * @param {number} progress ความคืบหน้า 0–1
   * @param {string} pattern รูปแบบการเคลื่อนที่
   * @returns {{x:number, y:number}} ตำแหน่งปกติ
   */
  function positionAt(progress, pattern) {
    const tau = Math.PI * 2;
    switch (pattern) {
      case "circular":
        return { x: 0.5 + 0.34 * Math.cos(tau * 1.2 * progress),
                 y: 0.5 + 0.30 * Math.sin(tau * 1.2 * progress) };
      case "lissajous":
        return { x: 0.5 + 0.36 * Math.sin(tau * 1.4 * progress),
                 y: 0.5 + 0.28 * Math.sin(tau * 2.8 * progress) };
      case "step": {
        const slot = Math.floor(progress * 12) % 4;
        return { x: [0.16, 0.84, 0.5, 0.84][slot], y: [0.5, 0.5, 0.22, 0.78][slot] };
      }
      default:
        return { x: 0.5 + 0.38 * Math.sin(tau * 1.1 * progress),
                 y: 0.5 + 0.10 * Math.sin(tau * 0.55 * progress) };
    }
  }

  // ─── กล้อง ──────────────────────────────────────────────────────────────
  /**
   * ขอสิทธิ์และเปิดกล้องหน้า
   * @returns {Promise<void>}
   */
  async function openCamera() {
    const status = $("setupStatus");
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = "เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้อง";
      status.className = "status bad";
      return;
    }
    if (!window.isSecureContext) {
      status.textContent = "ต้องเปิดผ่าน https:// หรือ http://localhost เท่านั้น จึงจะใช้กล้องได้";
      status.className = "status bad";
      return;
    }

    try {
      status.textContent = "กำลังขอสิทธิ์เข้าถึงกล้อง…";
      status.className = "status";
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 15 },
        },
        audio: false,
      });
      $("setupPreview").srcObject = state.stream;
      $("taskPreview").srcObject = state.stream;
      $("btnStartTask").disabled = false;
      status.textContent = "กล้องพร้อมแล้ว — จัดใบหน้าให้อยู่ในกรอบ";
      status.className = "status ok";
    } catch (err) {
      const denied = err.name === "NotAllowedError";
      status.textContent = denied
        ? "คุณปฏิเสธสิทธิ์กล้อง กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์แล้วลองใหม่"
        : "เปิดกล้องไม่ได้: " + err.message;
      status.className = "status bad";
    }
  }

  /** ปิดกล้องและคืนทรัพยากร */
  function closeCamera() {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  // ─── การทำแบบทดสอบ ──────────────────────────────────────────────────────
  /**
   * นับถอยหลัง เริ่มบันทึก และเล่นแอนิเมชันลูกบอลจนครบเวลา
   * @returns {Promise<void>}
   */
  async function runTask() {
    show("task");
    state.aborted = false;
    state.chunks = [];
    state.trajectory = [];

    const countdown = $("countdown");
    countdown.style.display = "flex";
    for (let n = 3; n > 0 && !state.aborted; n--) {
      countdown.textContent = String(n);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    countdown.style.display = "none";
    if (state.aborted) return;

    const mimeType = ["video/mp4", "video/webm;codecs=vp9", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported(type)) || "";
    state.recorder = new MediaRecorder(
      state.stream,
      mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined,
    );
    state.recorder.ondataavailable = (event) => {
      if (event.data.size) state.chunks.push(event.data);
    };
    state.recorder.onstop = () => {
      if (!state.aborted) submitRecording(mimeType);
    };
    state.recorder.start();

    const seconds = state.settings.duration;
    const pattern = state.settings.pattern;
    const ball = $("ball");
    ball.style.display = "block";
    $("recBadge").style.display = "flex";
    state.startedAt = performance.now();
    state.running = true;

    const tick = () => {
      if (!state.running) return;
      const elapsed = (performance.now() - state.startedAt) / 1000;
      const progress = elapsed / seconds;
      if (progress >= 1) {
        stopTask();
        return;
      }
      const point = positionAt(progress, pattern);
      ball.style.left = point.x * 100 + "%";
      ball.style.top = point.y * 100 + "%";
      $("taskProgress").style.width = progress * 100 + "%";
      // เวลาอ้างอิงจุดเริ่มเดียวกับวิดีโอ — backend ต้องการแบบนี้
      state.trajectory.push({
        t: +elapsed.toFixed(4),
        x: +point.x.toFixed(5),
        y: +point.y.toFixed(5),
      });
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  /** หยุดแอนิเมชันและปิดการบันทึก */
  function stopTask() {
    if (!state.running) return;
    state.running = false;
    cancelAnimationFrame(state.rafId);
    $("ball").style.display = "none";
    $("recBadge").style.display = "none";
    $("taskProgress").style.width = "0";
    if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  }

  // ─── ส่งผลและแสดงผลลัพธ์ ────────────────────────────────────────────────
  /**
   * รวมชิ้นวิดีโอแล้วส่งไปทำนาย
   * @param {string} mimeType MIME type ที่ MediaRecorder ใช้
   * @returns {Promise<void>}
   */
  async function submitRecording(mimeType) {
    const type = mimeType || "video/webm";
    const blob = new Blob(state.chunks, { type });
    const extension = type.includes("mp4") ? "mp4" : "webm";

    show("processing");
    $("processingTitle").textContent = "กำลังอัปโหลด…";
    $("processingDetail").textContent = `ขนาดไฟล์ ${(blob.size / 1048576).toFixed(1)} MB`;
    $("uploadProgress").style.width = "0";

    try {
      const body = await uploadRecording(blob, extension, (ratio) => {
        $("uploadProgress").style.width = ratio * 100 + "%";
        if (ratio >= 1) {
          $("processingTitle").textContent = "กำลังวิเคราะห์…";
          $("processingDetail").textContent = "ตรวจจับใบหน้าและคำนวณค่าการเคลื่อนไหวดวงตา";
        }
      });
      renderResult(body);
    } catch (payload) {
      if (payload?.error === "UnauthorizedError") {
        requireLogin();
        return;
      }
      renderError(payload);
    }
  }

  /**
   * แสดงผลบนหน้าจอผลลัพธ์
   *
   * รองรับสองรูปแบบ payload: /api/predict คืนค่าแบนราบ ส่วน /api/upload
   * ห่อผลทำนายไว้ใน `prediction` และอาจเป็น null เมื่อยังไม่มีโมเดล
   *
   * @param {object} body payload จาก POST /api/predict หรือ /api/upload
   */
  function renderResult(body) {
    const prediction = body.prediction || (body.risk_score !== undefined ? body : null);

    // แจ้งว่าตัวอย่างถูกบันทึกเข้าชุดข้อมูลแล้ว (เฉพาะเส้นทาง /api/upload)
    const badge = $("savedBadge");
    if (body.dataset_path) {
      const label = state.settings.label === "1" ? "กลุ่มเสี่ยง (1)" : "กลุ่มควบคุม (0)";
      badge.textContent =
        `บันทึกเข้าชุดข้อมูลแล้ว — ${label}` +
        (body.video_deleted ? " · ลบไฟล์วิดีโอแล้วเพื่อประหยัดพื้นที่" : "");
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }

    $("predictionBlock").hidden = !prediction;
    $("noModelNotice").hidden = !!prediction;

    if (prediction) renderGauge(prediction);
    renderQuality(body, prediction);
    renderFeatures(body.features || prediction?.features || {});
    $("rawJson").textContent = JSON.stringify(body, null, 2);

    show("result");
  }

  /**
   * วาดมาตรวัดคะแนนความเสี่ยง
   * @param {object} prediction ผลทำนายที่มี risk_score / risk_level
   */
  function renderGauge(prediction) {
    const score = Number(prediction.risk_score) || 0;
    const level = prediction.risk_level || "–";

    $("resScore").textContent = score.toFixed(3);
    $("resScore").className = "level-" + level;
    $("resLevel").textContent = { Low: "ความเสี่ยงต่ำ", Moderate: "ความเสี่ยงปานกลาง", High: "ความเสี่ยงสูง" }[level] || level;
    $("resLevel").className = "level-" + level;

    const gauge = $("gaugeFill");
    gauge.setAttribute("class", "gauge-fill level-" + level);
    // ความยาวเส้นโค้งราว 270 หน่วย ตามที่ตั้ง stroke-dasharray ไว้
    requestAnimationFrame(() => {
      gauge.style.strokeDashoffset = String(270 - Math.max(0, Math.min(1, score)) * 270);
    });
  }

  /**
   * แสดงการ์ดคุณภาพการบันทึก
   * @param {object} body payload เต็มจาก backend
   * @param {object|null} prediction ผลทำนาย ถ้ามี
   */
  function renderQuality(body, prediction) {
    const video = body.video || {};
    const meta = body.sample_metadata || prediction?.metadata || {};
    const detection = Number(video.detection_ratio ?? meta.detection_ratio ?? 0);
    const usedTarget = meta.tracking_error_source === "target";

    $("qualityGrid").innerHTML = [
      ["ตรวจพบใบหน้า", (detection * 100).toFixed(0) + "%", detection >= 0.9 ? "level-Low" : detection >= 0.7 ? "level-Moderate" : "level-High"],
      ["ความยาวที่วิเคราะห์", (Number(meta.duration) || 0).toFixed(1) + " วิ", ""],
      ["จำนวนการกะพริบตา", meta.blink_count ?? "–", ""],
      ["เทียบกับเป้าหมายจริง", usedTarget ? "ใช่" : "ไม่ใช่", usedTarget ? "level-Low" : "level-Moderate"],
    ]
      .map(([label, value, cls]) => `<div><span>${label}</span><b class="${cls}">${value}</b></div>`)
      .join("");
  }

  /**
   * แสดงตารางค่าที่วัดได้ทั้งหมด
   * @param {object} features แผนที่ชื่อ feature ไปยังค่า
   */
  function renderFeatures(features) {
    const rows = Object.entries(features).map(([key, value]) => {
      const [label, unit] = FEATURE_LABELS[key] || [key, ""];
      return `<tr><td>${label}<small>${unit}</small></td><td>${Number(value).toFixed(4)}</td></tr>`;
    });
    $("featureTable").querySelector("tbody").innerHTML = rows.join("");
  }

  /**
   * แสดงหน้าข้อผิดพลาดพร้อมคำแนะนำเฉพาะชนิดของ error
   * @param {object} payload envelope ของ error จาก backend
   */
  function renderError(payload) {
    const code = payload?.error || "UnknownError";
    $("errorTitle").textContent =
      code === "NoFaceDetectedError" ? "ตรวจไม่พบใบหน้า"
      : code === "ModelNotTrainedError" ? "ระบบยังไม่พร้อมใช้งาน"
      : "เกิดข้อผิดพลาด";
    $("errorMessage").textContent = payload?.message || "ไม่ทราบสาเหตุ";

    const hint = ERROR_HINTS[code];
    $("errorHint").hidden = !hint;
    if (hint) $("errorHint").textContent = hint;

    show("error");
  }

  // ─── การผูก event ───────────────────────────────────────────────────────
  /** อ่านค่าจากฟอร์มตั้งค่าเข้าสู่ state */
  function readSettings() {
    state.settings = {
      subjectId: $("subjectId").value.trim(),
      duration: Math.min(60, Math.max(10, Number($("duration").value) || 30)),
      pattern: $("pattern").value,
      apiBase: $("apiBase").value.trim(),
      label: RESEARCH_MODE ? $("label").value : "",
    };
  }

  /**
   * ตรวจว่าเริ่มทดสอบได้หรือยัง
   * @returns {string} ข้อความแจ้งเตือน หรือสตริงว่างเมื่อผ่าน
   */
  function validateBeforeStart() {
    if (RESEARCH_MODE && !state.settings.label) {
      return "โหมดนักวิจัยต้องเลือก label ก่อน — เปิด “ตั้งค่าการทดสอบ” แล้วเลือกกลุ่ม";
    }
    if (RESEARCH_MODE && !state.settings.subjectId) {
      return "กรุณาใส่รหัสผู้เข้าร่วม เพื่อให้แบ่งข้อมูลตามคนได้ในภายหลัง";
    }
    return "";
  }

  $("btnBegin").addEventListener("click", () => {
    readSettings();
    const problem = validateBeforeStart();
    const banner = $("introError");
    if (problem) {
      banner.textContent = problem;
      banner.hidden = false;
      $("settingsCard").open = true;
      banner.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    banner.hidden = true;
    show("setup");
    openCamera();
  });

  $("btnTrain").addEventListener("click", trainModel);
  $("btnRefreshStatus").addEventListener("click", loadTrainStatus);
  $("btnHomeFromResult").addEventListener("click", () => {
    show("intro");
    if (RESEARCH_MODE) loadTrainStatus();
  });

  $("btnBackToIntro").addEventListener("click", () => {
    closeCamera();
    show("intro");
  });

  $("btnStartTask").addEventListener("click", runTask);

  $("btnAbort").addEventListener("click", () => {
    state.aborted = true;
    stopTask();
    show("setup");
  });

  $("btnAgain").addEventListener("click", () => {
    show("setup");
    if (!state.stream) openCamera();
    else $("btnStartTask").disabled = false;
  });

  $("btnRetry").addEventListener("click", () => {
    show("setup");
    if (!state.stream) openCamera();
    else $("btnStartTask").disabled = false;
  });

  $("btnErrorHome").addEventListener("click", () => {
    closeCamera();
    show("intro");
  });


  // ปล่อยกล้องเมื่อออกจากหน้า เพื่อไม่ให้ไฟกล้องค้าง
  window.addEventListener("pagehide", closeCamera);

  // ─── เริ่มต้นตามโหมด ────────────────────────────────────────────────────
  /** เปิดหรือซ่อนส่วนที่มีเฉพาะโหมดนักวิจัย แล้วโหลดสถานะชุดข้อมูล */
  function initialiseMode() {
    document.body.classList.toggle("research", RESEARCH_MODE);
    if (!RESEARCH_MODE) return;

    document.title = "โหมดนักวิจัย — เก็บข้อมูลและเทรนโมเดล";
    $("settingsCard").open = true;
    loadTrainStatus();
  }

  initialiseMode();
})();
