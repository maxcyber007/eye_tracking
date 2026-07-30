/**
 * Dashboard for researchers and administrators.
 *
 * Two views in one page: the login form and, once a session cookie exists, the
 * management console (dataset status and training, the assessment report, and
 * the entry point into research-mode collection).
 *
 * The session cookie is HttpOnly, so this script can never read the token —
 * that is the point. Authentication state is discovered by asking the server
 * (`GET /api/auth/status`), and every protected call simply reacts to a 401 by
 * returning to the login form.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /** ขนาดหน้าของตารางรายงาน */
  const PAGE_SIZE = 25;

  /**
   * ชื่อโมเดลที่แสดงให้ผู้ใช้เห็น
   *
   * ฝั่งเซิร์ฟเวอร์ส่ง `model_type` ซึ่งคือชื่ออัลกอริทึม (เช่น `random_forest`)
   * และจะเปลี่ยนไปเมื่อสลับ estimator — จึงยังแสดงควบคู่กันไว้เสมอ
   * ไม่ให้หน้าจอปิดบังว่าคะแนนมาจากอัลกอริทึมใดจริงๆ
   */
  const MODEL_DISPLAY_NAME = "MyEye";

  const state = { user: null, offset: 0, total: 0, subject: "", rows: [] };

  // ─── เครื่องมือพื้นฐาน ──────────────────────────────────────────────────
  /**
   * แปลงข้อความให้ปลอดภัยก่อนใส่ลง innerHTML
   *
   * ค่าอย่าง subject_id และ filename มาจากผู้ใช้ จึงต้อง escape ทุกครั้ง
   *
   * @param {unknown} value ค่าที่จะแสดง
   * @returns {string} ข้อความที่ escape แล้ว
   */
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  /**
   * เรียก API พร้อมจัดการ 401 ให้เด้งกลับหน้าเข้าสู่ระบบ
   * @param {string} path เส้นทาง API
   * @param {RequestInit} [options] ตัวเลือกของ fetch
   * @returns {Promise<{ok:boolean, status:number, body:any}>} ผลลัพธ์
   */
  async function api(path, options) {
    const response = await fetch(path, { credentials: "same-origin", ...options });
    if (response.status === 401) {
      state.user = null;
      showLogin("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
      throw new Error("unauthorized");
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  }

  /**
   * จัดรูปแบบวันเวลาเป็นแบบไทยแบบสั้น
   * @param {string} isoText เวลาแบบ ISO-8601
   * @returns {string} ข้อความวันเวลา
   */
  function formatDate(isoText) {
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return isoText || "—";
    return date.toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
  }

  // ─── สลับมุมมอง ─────────────────────────────────────────────────────────
  /**
   * แสดงหน้าเข้าสู่ระบบ
   * @param {string} [message] ข้อความแจ้งเตือนที่จะแสดงใต้ฟอร์ม
   */
  function showLogin(message) {
    $("view-login").classList.add("active");
    $("view-dashboard").classList.remove("active");
    const error = $("loginError");
    error.hidden = !message;
    if (message) error.textContent = message;
  }

  /** แสดงแดชบอร์ดและโหลดข้อมูลตั้งต้น */
  function showDashboard() {
    $("view-login").classList.remove("active");
    $("view-dashboard").classList.add("active");
    $("currentUser").textContent = state.user
      ? `${state.user.display_name} (${state.user.role})`
      : "";
    loadTrainStatus();
    loadSystemStatus();
  }

  // ─── เข้าสู่ระบบ / ออกจากระบบ ───────────────────────────────────────────
  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("btnLogin");
    const error = $("loginError");
    button.disabled = true;
    button.textContent = "กำลังตรวจสอบ…";
    error.hidden = true;

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: $("username").value.trim(),
          password: $("password").value,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        error.hidden = false;
        error.textContent = body.message || "เข้าสู่ระบบไม่สำเร็จ";
        return;
      }

      state.user = body.user;
      $("password").value = "";

      // เด้งกลับไปหน้าที่ตั้งใจจะไป ถ้าถูกส่งมาจากหน้าที่ต้องล็อกอิน
      const next = new URLSearchParams(location.search).get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        location.href = next;
        return;
      }
      showDashboard();
    } catch (err) {
      error.hidden = false;
      error.textContent = "ติดต่อเซิร์ฟเวอร์ไม่ได้: " + err.message;
    } finally {
      button.disabled = false;
      button.textContent = "เข้าสู่ระบบ";
    }
  });

  $("btnLogout").addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      state.user = null;
      $("username").value = "";
      showLogin("ออกจากระบบแล้ว");
    }
  });

  // ─── แท็บ ───────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((el) => el.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((el) => el.classList.remove("active"));
      tab.classList.add("active");
      $("tab-" + tab.dataset.tab).classList.add("active");
      if (tab.dataset.tab === "history") loadHistory();
      if (tab.dataset.tab === "settings") loadSettingsStatus();
    });
  });

  // ─── ภาพรวม: ชุดข้อมูลและการเทรน ────────────────────────────────────────
  /**
   * โหลดสถานะชุดข้อมูลและโมเดล
   * @returns {Promise<void>}
   */
  async function loadTrainStatus() {
    const stats = $("datasetStats");
    const button = $("btnTrain");
    stats.innerHTML = '<div><span>สถานะ</span><b>กำลังโหลด…</b></div>';
    button.disabled = true;

    try {
      const { body } = await api("/api/train/status");
      const dataset = body.dataset || {};
      const model = body.model || {};
      const counts = dataset.label_counts || {};
      const control = Number(counts["0"] || 0);
      const atRisk = Number(counts["1"] || 0);
      const ready = control >= 2 && atRisk >= 2;

      stats.innerHTML = [
        ["ตัวอย่างทั้งหมด", dataset.rows || 0, ""],
        ["โมเดลปัจจุบัน", model.available ? MODEL_DISPLAY_NAME : "ยังไม่มี",
         model.available ? "level-Low" : "level-Moderate"],
        ["อัลกอริทึม", model.available ? model.model_type : "—", ""],
        ["กลุ่มควบคุม (0)", control, control >= 2 ? "level-Low" : "level-High"],
        ["กลุ่มเสี่ยง (1)", atRisk, atRisk >= 2 ? "level-Low" : "level-High"],
      ]
        .map(([l, v, c]) => `<div><span>${escapeHtml(l)}</span><b class="${c}">${escapeHtml(v)}</b></div>`)
        .join("");

      button.disabled = !ready;
      button.textContent = ready ? "เทรนโมเดล" : "ต้องมีอย่างน้อย 2 ตัวอย่างในแต่ละกลุ่ม";
      if (model.available && model.metrics) renderTrainMetrics(model.metrics, false);
    } catch {
      /* 401 ถูกจัดการใน api() แล้ว */
    }
  }

  /**
   * โหลดสถานะระบบจาก /health
   * @returns {Promise<void>}
   */
  async function loadSystemStatus() {
    try {
      const response = await fetch("/health", { credentials: "same-origin" });
      const body = await response.json();
      const rows = [
        ["สถานะบริการ", body.status],
        ["เวอร์ชัน", body.version],
        ["สภาพแวดล้อม", body.environment],
        ["ฐานข้อมูล", body.database ? "เชื่อมต่อได้" : "มีปัญหา"],
        ["โมเดลพร้อมใช้", body.model_available ? "ใช่" : "ยังไม่มี"],
        ["จำนวนผลประเมินสะสม", body.history_count],
        ["อัลกอริทึมที่ลงทะเบียนไว้", (body.available_models || []).join(", ")],
      ];
      $("systemTable").querySelector("tbody").innerHTML = rows
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
        .join("");
    } catch {
      $("systemTable").querySelector("tbody").innerHTML =
        '<tr><td>สถานะ</td><td>ติดต่อเซิร์ฟเวอร์ไม่ได้</td></tr>';
    }
  }

  $("btnRefreshStatus").addEventListener("click", () => {
    loadTrainStatus();
    loadSystemStatus();
  });

  $("btnTrain").addEventListener("click", async () => {
    const button = $("btnTrain");
    button.disabled = true;
    button.textContent = "กำลังเทรน…";
    try {
      const { ok, body } = await api("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!ok) {
        $("trainResult").hidden = false;
        $("trainResult").innerHTML =
          `<div class="train-error">เทรนไม่สำเร็จ — ${escapeHtml(body?.message || body?.error || "ไม่ทราบสาเหตุ")}</div>`;
        return;
      }
      await loadTrainStatus();
      renderTrainMetrics(body.metrics, true);
      loadSystemStatus();
    } catch {
      /* 401 จัดการแล้ว */
    } finally {
      button.textContent = "เทรนโมเดล";
      button.disabled = false;
    }
  });

  /**
   * แสดงตัวชี้วัดของโมเดล
   * @param {object} metrics ตัวชี้วัดจากการเทรน
   * @param {boolean} justTrained เพิ่งเทรนเสร็จหรือเป็นโมเดลเดิม
   */
  function renderTrainMetrics(metrics, justTrained) {
    if (!metrics || metrics.accuracy === undefined) return;
    const box = $("trainResult");
    box.hidden = false;

    const rows = [
      ["Accuracy", metrics.accuracy], ["F1", metrics.f1_score],
      ["Precision", metrics.precision], ["Recall", metrics.recall],
      ["ROC AUC", metrics.roc_auc], ["CV accuracy", metrics.cv_mean_accuracy],
    ]
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([l, v]) => `<div><span>${l}</span><b>${Number(v).toFixed(3)}</b></div>`)
      .join("");

    const tiny = Number(metrics.test_samples) < 10
      ? `<p class="train-note warn-note">ชุดทดสอบมีเพียง ${metrics.test_samples} ตัวอย่าง
         ตัวเลขข้างบนจึงยังไม่มีความหมายทางสถิติ ใช้ยืนยันได้แค่ว่าระบบเทรนผ่านเท่านั้น</p>`
      : "";

    box.innerHTML = `
      <div class="train-head">${justTrained ? "เทรนสำเร็จ" : "โมเดลที่ใช้อยู่"} —
        ${metrics.train_samples} train / ${metrics.test_samples} test</div>
      <div class="quality metrics">${rows}</div>
      ${tiny}
      <p class="train-note">ตัวเลขนี้วัดจากการแบ่งข้อมูลแบบสุ่ม ไม่ได้แบ่งตามผู้เข้าร่วม
        ถ้ามีหลายคลิปต่อคน ค่าที่เห็นจะสูงกว่าความเป็นจริง</p>`;
  }

  // ─── รายงานประวัติ ──────────────────────────────────────────────────────
  /**
   * โหลดรายงานประวัติหน้าปัจจุบัน
   * @returns {Promise<void>}
   */
  async function loadHistory() {
    const tbody = $("historyTable").querySelector("tbody");
    tbody.innerHTML = '<tr><td colspan="6" class="empty">กำลังโหลด…</td></tr>';

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(state.offset) });
    if (state.subject) params.set("subject_id", state.subject);

    try {
      const { body } = await api("/api/history?" + params.toString());
      state.total = body.total || 0;
      state.rows = body.items || [];

      if (!state.rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">ไม่มีข้อมูล</td></tr>';
      } else {
        tbody.innerHTML = state.rows
          .map((item) => `
            <tr>
              <td>${item.id}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td>${escapeHtml(item.subject_id || "—")}</td>
              <td class="num">${Number(item.risk_score).toFixed(3)}</td>
              <td><span class="pill level-${escapeHtml(item.risk_level)}">${escapeHtml(item.risk_level)}</span></td>
              <td><button class="row-del" data-id="${item.id}" title="ลบรายการนี้">✕</button></td>
            </tr>`)
          .join("");
      }

      renderHistorySummary();
      const from = state.total ? state.offset + 1 : 0;
      const to = Math.min(state.offset + PAGE_SIZE, state.total);
      $("pageInfo").textContent = `${from}–${to} จาก ${state.total}`;
      $("btnPrev").disabled = state.offset <= 0;
      $("btnNext").disabled = state.offset + PAGE_SIZE >= state.total;

      tbody.querySelectorAll(".row-del").forEach((button) => {
        button.addEventListener("click", () => deleteRow(Number(button.dataset.id)));
      });
    } catch {
      /* 401 จัดการแล้ว */
    }
  }

  /** สรุปการกระจายของระดับความเสี่ยงในหน้าที่กำลังแสดง */
  function renderHistorySummary() {
    const counts = { Low: 0, Moderate: 0, High: 0 };
    state.rows.forEach((item) => {
      if (counts[item.risk_level] !== undefined) counts[item.risk_level] += 1;
    });
    const subjects = new Set(state.rows.map((item) => item.subject_id).filter(Boolean)).size;

    $("historySummary").innerHTML = [
      ["ทั้งหมด (ทุกหน้า)", state.total, ""],
      ["ผู้เข้าร่วมในหน้านี้", subjects, ""],
      ["ความเสี่ยงต่ำ", counts.Low, "level-Low"],
      ["ปานกลาง", counts.Moderate, "level-Moderate"],
      ["สูง", counts.High, "level-High"],
    ]
      .map(([l, v, c]) => `<div><span>${l}</span><b class="${c}">${v}</b></div>`)
      .join("");
  }

  /**
   * ลบผลประเมินหนึ่งรายการ
   * @param {number} id คีย์หลักของรายการ
   * @returns {Promise<void>}
   */
  async function deleteRow(id) {
    if (!window.confirm(`ลบผลประเมินรายการ #${id}?`)) return;
    try {
      const { ok, body } = await api(`/api/history/${id}`, { method: "DELETE" });
      const notice = $("historyNotice");
      notice.hidden = false;
      notice.className = ok ? "status ok" : "status bad";
      notice.textContent = body?.message || body?.error || "ไม่ทราบผลลัพธ์";
      if (ok) loadHistory();
    } catch {
      /* 401 จัดการแล้ว */
    }
  }

  $("btnApplyFilter").addEventListener("click", () => {
    state.subject = $("filterSubject").value.trim();
    state.offset = 0;
    loadHistory();
  });
  $("filterSubject").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("btnApplyFilter").click();
  });

  $("btnPrev").addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
    loadHistory();
  });
  $("btnNext").addEventListener("click", () => {
    state.offset += PAGE_SIZE;
    loadHistory();
  });

  $("btnClearHistory").addEventListener("click", async () => {
    const scope = state.subject ? `ของผู้เข้าร่วม "${state.subject}"` : "ทั้งหมด";
    if (!window.confirm(
      `ล้างผลย้อนหลัง${scope}?\n\n` +
      "ลบเฉพาะบันทึกการทำนาย\n" +
      "ชุดข้อมูลเทรน dataset.csv และโมเดลจะไม่ถูกลบ\n\n" +
      "การกระทำนี้ย้อนกลับไม่ได้",
    )) return;

    const params = new URLSearchParams({ confirm: "true" });
    if (state.subject) params.set("subject_id", state.subject);

    try {
      const { ok, body } = await api("/api/history?" + params.toString(), { method: "DELETE" });
      const notice = $("historyNotice");
      notice.hidden = false;
      notice.className = ok ? "status ok" : "status bad";
      notice.textContent = body?.message || body?.error || "ไม่ทราบผลลัพธ์";
      if (ok) {
        state.offset = 0;
        loadHistory();
        loadSystemStatus();
      }
    } catch {
      /* 401 จัดการแล้ว */
    }
  });

  /**
   * ดาวน์โหลดผลประเมินทั้งหมดที่ตรงกับตัวกรอง เป็นไฟล์ CSV
   *
   * ดึงทีละหน้าจนครบ เพื่อให้ไฟล์มีข้อมูลทุกแถว ไม่ใช่แค่หน้าที่เห็นอยู่
   *
   * @returns {Promise<void>}
   */
  async function exportCsv() {
    const button = $("btnExportCsv");
    button.disabled = true;
    button.textContent = "กำลังรวบรวม…";

    try {
      const all = [];
      for (let offset = 0; ; offset += 500) {
        const params = new URLSearchParams({ limit: "500", offset: String(offset) });
        if (state.subject) params.set("subject_id", state.subject);
        const { body } = await api("/api/history?" + params.toString());
        const items = body.items || [];
        all.push(...items);
        if (items.length < 500 || all.length >= (body.total || 0)) break;
      }

      const columns = ["id", "created_at", "subject_id", "filename",
                       "risk_score", "risk_level", "confidence", "model_type"];
      const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const csv = [
        columns.join(","),
        ...all.map((row) => columns.map((c) => escapeCell(row[c])).join(",")),
      ].join("\r\n");

      // BOM เพื่อให้ Excel บน Windows อ่านภาษาไทยได้ถูกต้อง
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `eye_tracking_history_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      /* 401 จัดการแล้ว */
    } finally {
      button.disabled = false;
      button.textContent = "ดาวน์โหลดเป็น CSV";
    }
  }

  $("btnExportCsv").addEventListener("click", exportCsv);

  // ─── แท็บตั้งค่า: ข้อมูลจำลองและการล้างข้อมูล ───────────────────────────
  /**
   * แสดงข้อความผลลัพธ์ของการตั้งค่า
   * @param {boolean} ok สำเร็จหรือไม่
   * @param {string} message ข้อความที่จะแสดง
   */
  function showSettingsNotice(ok, message) {
    const notice = $("settingsNotice");
    notice.hidden = false;
    notice.className = ok ? "status ok" : "status bad";
    notice.textContent = message;
  }

  /**
   * โหลดสถานะชุดข้อมูลและโมเดลสำหรับแท็บตั้งค่า
   *
   * ใช้ endpoint เดียวกับแท็บภาพรวม แต่แสดงคนละชุดตัวเลข และเปิด/ปิดปุ่มลบ
   * ตามสิ่งที่มีอยู่จริง เพื่อไม่ให้กดลบของที่ไม่มี
   *
   * @returns {Promise<void>}
   */
  async function loadSettingsStatus() {
    const stats = $("settingsStats");
    stats.innerHTML = '<div><span>สถานะ</span><b>กำลังโหลด…</b></div>';

    try {
      const { body } = await api("/api/train/status");
      const dataset = body.dataset || {};
      const model = body.model || {};
      const counts = dataset.label_counts || {};
      const rows = Number(dataset.rows || 0);

      stats.innerHTML = [
        ["ตัวอย่างในชุดข้อมูล", rows, ""],
        ["กลุ่มควบคุม (0)", Number(counts["0"] || 0), ""],
        ["กลุ่มเสี่ยง (1)", Number(counts["1"] || 0), ""],
        ["ชื่อโมเดล", model.available ? MODEL_DISPLAY_NAME : "ยังไม่มี",
         model.available ? "level-Low" : "level-Moderate"],
        ["อัลกอริทึม", model.available ? model.model_type : "—", ""],
      ]
        .map(([l, v, c]) => `<div><span>${escapeHtml(l)}</span><b class="${c}">${escapeHtml(v)}</b></div>`)
        .join("");

      $("btnDeleteDataset").disabled = rows === 0;
      $("btnDeleteModel").disabled = !model.available;
    } catch {
      /* 401 จัดการแล้ว */
    }
  }

  /**
   * รีเฟรชทุกแผงที่ได้รับผลกระทบจากการเปลี่ยนชุดข้อมูลหรือโมเดล
   * @returns {Promise<void>}
   */
  async function refreshAfterMaintenance() {
    await loadSettingsStatus();
    await loadTrainStatus();
    loadSystemStatus();
  }

  $("btnRefreshSettings").addEventListener("click", loadSettingsStatus);

  $("btnMock").addEventListener("click", async () => {
    const button = $("btnMock");
    const samples = Number($("mockSamples").value);
    const ratio = Number($("mockRatio").value);
    const append = $("mockAppend").checked;

    if (!Number.isFinite(samples) || samples < 4 || samples > 5000) {
      showSettingsNotice(false, "จำนวนตัวอย่างต้องอยู่ระหว่าง 4 ถึง 5000");
      return;
    }
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 100) {
      showSettingsNotice(false, "สัดส่วนกลุ่มเสี่ยงต้องอยู่ระหว่าง 1 ถึง 99");
      return;
    }
    if (!window.confirm(
      append
        ? `เพิ่มข้อมูลจำลอง ${samples} ตัวอย่างต่อท้ายข้อมูลเดิม?\n\n` +
          "ข้อมูลนี้ไม่ใช่การวัดจริง และจะปนอยู่กับข้อมูลจริงในไฟล์เดียวกัน"
        : `เขียนทับ dataset.csv ทั้งไฟล์ด้วยข้อมูลจำลอง ${samples} ตัวอย่าง?\n\n` +
          "ข้อมูลเดิมทั้งหมดจะหายและกู้คืนไม่ได้",
    )) return;

    button.disabled = true;
    button.textContent = "กำลังสร้าง…";
    try {
      const { ok, body } = await api("/api/dataset/mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples, positive_ratio: ratio / 100, append }),
      });
      showSettingsNotice(ok, body?.message || body?.error || "ไม่ทราบผลลัพธ์");
      if (ok) await refreshAfterMaintenance();
    } catch {
      /* 401 จัดการแล้ว */
    } finally {
      button.textContent = "สร้างข้อมูลจำลอง";
      button.disabled = false;
    }
  });

  $("btnDeleteDataset").addEventListener("click", async () => {
    if (!window.confirm(
      "ลบชุดข้อมูลทั้งหมด?\n\n" +
      "ตัวอย่างที่มี label ทุกแถวจะถูกลบและกู้คืนไม่ได้\n" +
      "โมเดลที่เทรนไว้ ผลย้อนหลัง และวิดีโอที่อัปโหลดไว้จะไม่ถูกแตะต้อง",
    )) return;

    try {
      const { ok, body } = await api("/api/dataset?confirm=true", { method: "DELETE" });
      showSettingsNotice(ok, body?.message || body?.error || "ไม่ทราบผลลัพธ์");
      if (ok) await refreshAfterMaintenance();
    } catch {
      /* 401 จัดการแล้ว */
    }
  });

  $("btnDeleteModel").addEventListener("click", async () => {
    if (!window.confirm(
      "ลบโมเดลปัจจุบัน?\n\n" +
      "หน้าประเมินจะทำนายไม่ได้จนกว่าจะเทรนใหม่\n" +
      "ชุดข้อมูลยังอยู่ครบ จึงเทรนใหม่ได้จากแท็บภาพรวม",
    )) return;

    try {
      const { ok, body } = await api("/api/model?confirm=true", { method: "DELETE" });
      showSettingsNotice(ok, body?.message || body?.error || "ไม่ทราบผลลัพธ์");
      if (ok) await refreshAfterMaintenance();
    } catch {
      /* 401 จัดการแล้ว */
    }
  });

  // ─── เริ่มต้น ───────────────────────────────────────────────────────────
  /**
   * ถามเซิร์ฟเวอร์ว่ามีเซสชันอยู่แล้วหรือไม่ แล้วเลือกมุมมองที่เหมาะสม
   * @returns {Promise<void>}
   */
  async function initialise() {
    try {
      const response = await fetch("/api/auth/status", { credentials: "same-origin" });
      const body = await response.json();
      if (body.authenticated) {
        state.user = body.user;
        showDashboard();
        return;
      }
    } catch {
      /* ถือว่ายังไม่ได้ล็อกอิน */
    }
    showLogin();
  }

  initialise();
})();
