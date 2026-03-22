// 全局脚本 / Global Script
export const API_BASE = "/api";

export async function fetchJSON(url, options = { headers: {} }) {
  const headers = {
    ...options.headers,
    "Content-Type": "application/json",
  };

  // 如果本地存储中有备份 Token，则放入请求头 (Bearer 模式)
  const token = localStorage.getItem("admin_token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let message = "请求失败";
    let data = null;
    try {
      data = await res.json();
      message = data.error || message;
    } catch (err) {
      message = message;
    }
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  if (res.status === 204) {
    return null;
  }
  return res.json();
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDate(dateString) {
  if (!dateString) return "暂无";
  const options = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  };
  return new Date(dateString).toLocaleString("zh-CN", options);
}

/* ========== 全局提示 (Toast) ========== */
export function showToast(message, type = "info", duration = 3000) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ========== 全局弹窗 (Modal) ========== */
export function showModal({ title, content, onConfirm, confirmText = "确定", cancelText = "取消" }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <div class="modal-close">&times;</div>
      </div>
      <div class="modal-body">${content}</div>
      <div class="modal-footer">
        <button class="btn cancel">${cancelText}</button>
        <button class="btn primary confirm">${confirmText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add("active"), 10);

  const close = () => {
    overlay.classList.remove("active");
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector(".modal-close").onclick = close;
  overlay.querySelector(".cancel").onclick = close;
  overlay.querySelector(".confirm").onclick = () => {
    if (onConfirm) onConfirm();
    close();
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
}

/* ========== 分页控件 (Pagination) ========== */
export function renderPagination({ container, total, current, limit, onPageChange }) {
  if (!container) return;
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  container.className = "pagination";
  container.innerHTML = "";

  const prev = document.createElement("button");
  prev.className = "page-btn";
  prev.innerHTML = "&lt;";
  prev.disabled = current === 1;
  prev.onclick = () => onPageChange(current - 1);
  container.appendChild(prev);

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= current - 1 && i <= current + 1)) {
      const btn = document.createElement("button");
      btn.className = `page-btn ${i === current ? "active" : ""}`;
      btn.textContent = i;
      btn.onclick = () => onPageChange(i);
      container.appendChild(btn);
    } else if (i === current - 2 || i === current + 2) {
      const dot = document.createElement("span");
      dot.textContent = "...";
      container.appendChild(dot);
    }
  }

  const next = document.createElement("button");
  next.className = "page-btn";
  next.innerHTML = "&gt;";
  next.disabled = current === totalPages;
  next.onclick = () => onPageChange(current + 1);
  container.appendChild(next);
}

/* ========== 加载状态 (Loading State) ========== */
export function showLoading(container) {
  if (!container) return;
  const loader = document.createElement("div");
  loader.className = "flex-center mt-3 mb-3";
  loader.innerHTML = '<div class="spinner"></div>';
  loader.dataset.loader = "true";
  container.innerHTML = "";
  container.appendChild(loader);
}

export function hideLoading(container) {
  if (!container) return;
  const loader = container.querySelector('[data-loader="true"]');
  if (loader) loader.remove();
}

/* ========== 空状态 (Empty State) ========== */
export function renderEmpty(container, message = "暂无内容") {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">☕</div>
      <div class="empty-text">${message}</div>
    </div>
  `;
}

/* ========== 站点动态配置加载 (备案信息等) ========== */
export async function initFooter() {
  try {
    const settings = await fetchJSON(`${API_BASE}/settings`);
    const footerBeian = document.querySelector(".footer-beian");
    if (!footerBeian) return;

    let html = "";
    if (settings.icp_beian) {
      html += `<a href="https://beian.miit.gov.cn/" target="_blank">${escapeHTML(settings.icp_beian)}</a>`;
    }
    if (settings.gongan_beian) {
      const url = settings.gongan_url || "http://www.beian.gov.cn/";
      html += `
        <a href="${escapeHTML(url)}" target="_blank">
          <img src="/globals/images/beian.png" alt="备案图标">
          ${escapeHTML(settings.gongan_beian)}
        </a>
      `;
    }
    
    if (html) {
      footerBeian.innerHTML = html;
    } else {
      footerBeian.style.display = "none";
    }
  } catch (err) {
    console.error("加载站点配置失败:", err);
  }
}

