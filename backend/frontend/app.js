/**
 * Web client for the Alzheimer eye-tracking risk prototype.
 *
 * Flow: intro -> setup (camera) -> task (pursuit + recording) -> processing
 *       (upload) -> result. The stimulus position is logged on every animation
 *       frame against the recording's own time origin, which is what lets the
 *       backend compute `tracking_error` against the real target path instead
 *       of falling back to its self-consistency proxy.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

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
    settings: { subjectId: "", duration: 30, pattern: "horizontal", apiBase: "" },
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
   * ส่งวิดีโอไปทำนาย พร้อมรายงานความคืบหน้าการอัปโหลด
   * @param {Blob} blob ไฟล์วิดีโอที่บันทึกได้
   * @param {string} extension นามสกุลไฟล์ที่เหมาะกับ MIME type
   * @param {(ratio:number)=>void} onProgress callback รับค่า 0–1
   * @returns {Promise<object>} payload จาก backend
   */
  function uploadForPrediction(blob, extension, onProgress) {
    const form = new FormData();
    form.append("file", blob, `recording.${extension}`);
    form.append("target_trajectory", JSON.stringify(state.trajectory));
    if (state.settings.subjectId) form.append("subject_id", state.settings.subjectId);

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", apiUrl("/api/predict"));
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
      const body = await uploadForPrediction(blob, extension, (ratio) => {
        $("uploadProgress").style.width = ratio * 100 + "%";
        if (ratio >= 1) {
          $("processingTitle").textContent = "กำลังวิเคราะห์…";
          $("processingDetail").textContent = "ตรวจจับใบหน้าและคำนวณค่าการเคลื่อนไหวดวงตา";
        }
      });
      renderResult(body);
    } catch (payload) {
      renderError(payload);
    }
  }

  /**
   * แสดงผลการทำนายบนหน้าจอผลลัพธ์
   * @param {object} body payload จาก POST /api/predict
   */
  function renderResult(body) {
    const score = Number(body.risk_score) || 0;
    const level = body.risk_level || "–";

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

    const video = body.video || {};
    const meta = body.sample_metadata || {};
    const detection = Number(video.detection_ratio || 0);
    const usedTarget = meta.tracking_error_source === "target";

    $("qualityGrid").innerHTML = [
      ["ตรวจพบใบหน้า", (detection * 100).toFixed(0) + "%", detection >= 0.9 ? "level-Low" : detection >= 0.7 ? "level-Moderate" : "level-High"],
      ["ความยาวที่วิเคราะห์", (Number(meta.duration) || 0).toFixed(1) + " วิ", ""],
      ["จำนวนการกะพริบตา", meta.blink_count ?? "–", ""],
      ["เทียบกับเป้าหมายจริง", usedTarget ? "ใช่" : "ไม่ใช่", usedTarget ? "level-Low" : "level-Moderate"],
    ]
      .map(([label, value, cls]) => `<div><span>${label}</span><b class="${cls}">${value}</b></div>`)
      .join("");

    const rows = Object.entries(body.features || {}).map(([key, value]) => {
      const [label, unit] = FEATURE_LABELS[key] || [key, ""];
      return `<tr><td>${label}<small>${unit}</small></td><td>${Number(value).toFixed(4)}</td></tr>`;
    });
    $("featureTable").querySelector("tbody").innerHTML = rows.join("");
    $("rawJson").textContent = JSON.stringify(body, null, 2);

    show("result");
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

  // ─── ประวัติ ────────────────────────────────────────────────────────────
  /**
   * ดึงและแสดงผลย้อนหลังจาก GET /api/history
   * @returns {Promise<void>}
   */
  async function loadHistory() {
    const container = $("historyList");
    container.innerHTML = '<div class="empty">กำลังโหลด…</div>';
    show("history");

    try {
      const response = await fetch(apiUrl("/api/history?limit=25"));
      const body = await response.json();
      const items = body.items || [];
      if (!items.length) {
        container.innerHTML = '<div class="empty">ยังไม่มีผลการทดสอบ</div>';
        return;
      }
      container.innerHTML = items
        .map((item) => {
          const when = new Date(item.created_at).toLocaleString("th-TH", {
            dateStyle: "short",
            timeStyle: "short",
          });
          return `<div class="history-item">
            <div class="meta">
              <b>${item.subject_id || "ไม่ระบุรหัส"}</b>
              <span>${when}</span>
            </div>
            <div class="val">
              <b class="level-${item.risk_level}">${Number(item.risk_score).toFixed(2)}</b>
              <span class="level-${item.risk_level}">${item.risk_level}</span>
            </div>
          </div>`;
        })
        .join("");
    } catch {
      container.innerHTML = '<div class="empty">โหลดประวัติไม่สำเร็จ</div>';
    }
  }

  // ─── การผูก event ───────────────────────────────────────────────────────
  /** อ่านค่าจากฟอร์มตั้งค่าเข้าสู่ state */
  function readSettings() {
    state.settings = {
      subjectId: $("subjectId").value.trim(),
      duration: Math.min(60, Math.max(10, Number($("duration").value) || 30)),
      pattern: $("pattern").value,
      apiBase: $("apiBase").value.trim(),
    };
  }

  $("btnBegin").addEventListener("click", () => {
    readSettings();
    show("setup");
    openCamera();
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

  $("btnHistoryFromIntro").addEventListener("click", () => {
    readSettings();
    loadHistory();
  });
  $("btnHistoryFromResult").addEventListener("click", loadHistory);
  $("btnBackFromHistory").addEventListener("click", () => show("intro"));

  // ปล่อยกล้องเมื่อออกจากหน้า เพื่อไม่ให้ไฟกล้องค้าง
  window.addEventListener("pagehide", closeCamera);
})();
