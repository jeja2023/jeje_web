// 管理后台脚本 / Admin Script
import { API_BASE, fetchJSON, formatDate, showToast, showModal } from "/globals/global.js";

const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("loginForm");
const adminPanel = document.getElementById("adminPanel");
const tabs = document.querySelectorAll(".tab");
const tabMessages = document.getElementById("tab-messages");
const tabProjects = document.getElementById("tab-projects");
const adminMessageList = document.getElementById("adminMessageList");
const replyForm = document.getElementById("replyForm");
const projectList = document.getElementById("projectList");
const projectForm = document.getElementById("projectForm");
const logoutBtn = document.getElementById("logoutBtn");
const editor = document.getElementById("projectEditor");
const contentHtml = document.getElementById("contentHtml");
const toolbar = document.querySelector(".editor-toolbar");
const imageUploadBtn = document.getElementById("imageUploadBtn");
const imageUploadInput = document.getElementById("imageUploadInput");
const statsProjects = document.getElementById("stats-projects");
const statsMessages = document.getElementById("stats-messages");
const statsPending = document.getElementById("stats-pending");
const statsToday = document.getElementById("stats-today");
const tabDashboard = document.getElementById("tab-dashboard");

const state = {
  messages: [],
  projects: [],
};

let savedRange = null;

function isAuthError(err) {
  return err && /unauthorized|session/i.test(err.message);
}

function statusLabel(status) {
  if (status === 1) return "已公开";
  if (status === 2) return "已隐藏";
  return "待审核";
}

function setLoggedIn(loggedIn) {
  loginCard.style.display = loggedIn ? "none" : "block";
  adminPanel.style.display = loggedIn ? "block" : "none";
}

function showTab(name) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  tabDashboard.style.display = name === "dashboard" ? "block" : "none";
  tabMessages.style.display = name === "messages" ? "block" : "none";
  tabProjects.style.display = name === "projects" ? "block" : "none";
  
  // 切换到控制面板时刷新数据
  if (name === "dashboard") loadStats();
}

function createStatusPill(status) {
  const pill = document.createElement("span");
  pill.className = `pill status-${status}`;
  pill.textContent = statusLabel(status);
  return pill;
}

function createActionButton(label, onClick, options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn small${options.primary ? " primary" : ""}`;
  btn.textContent = label;
  if (options.danger) {
    btn.classList.add("danger");
  }
  if (options.disabled) {
    btn.disabled = true;
  }
  btn.addEventListener("click", onClick);
  return btn;
}

async function updateMessageStatus(id, status) {
  try {
    await fetchJSON(`${API_BASE}/admin/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    showToast("状态更新成功", "success");
    await loadMessages();
  } catch (err) {
    showToast(`更新失败: ${err.message}`, "error");
  }
}

async function deleteMessage(id) {
  showModal({
    title: "确认删除",
    content: "确定要删除这条留言吗？此操作不可撤销。",
    onConfirm: async () => {
      try {
        await fetchJSON(`${API_BASE}/admin/messages/${id}`, {
          method: "DELETE",
        });
        showToast("留言已删除", "success");
        await loadMessages();
      } catch (err) {
        showToast(`删除失败: ${err.message}`, "error");
      }
    }
  });
}

async function deleteProject(id) {
  showModal({
    title: "确认删除",
    content: "确定要删除这个项目吗？",
    onConfirm: async () => {
      try {
        await fetchJSON(`${API_BASE}/admin/projects/${id}`, {
          method: "DELETE",
        });
        showToast("项目已删除", "success");
        await loadProjects();
      } catch (err) {
        showToast(`删除失败: ${err.message}`, "error");
      }
    }
  });
}

function renderReplies(container, replies) {
  if (!replies || !replies.length) return;
  replies.forEach((reply) => {
    const replyEl = document.createElement("div");
    replyEl.className = "reply";
    const strong = document.createElement("strong");
    strong.textContent = "管理员回复：";
    replyEl.append(strong, document.createTextNode(` ${reply.content}`));
    container.appendChild(replyEl);
  });
}

function renderAdminMessage(msg) {
  const item = document.createElement("div");
  item.className = "message";

  const metaRow = document.createElement("div");
  metaRow.className = "meta-row";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `#${msg.id} ${msg.nickname} · ${formatDate(msg.created_at)}`;

  metaRow.append(meta, createStatusPill(msg.status));

  const content = document.createElement("div");
  content.textContent = msg.content;

  item.append(metaRow, content);

  if (msg.contact) {
    const contact = document.createElement("div");
    contact.className = "notice";
    contact.textContent = `联系方式：${msg.contact}`;
    item.appendChild(contact);
  }

  renderReplies(item, msg.replies);

  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(
    createActionButton("审核通过", () => updateMessageStatus(msg.id, 1), {
      primary: msg.status !== 1,
      disabled: msg.status === 1,
    }),
    createActionButton("隐藏", () => updateMessageStatus(msg.id, 2), {
      disabled: msg.status === 2,
    }),
    createActionButton("设为待审", () => updateMessageStatus(msg.id, 0), {
      disabled: msg.status === 0,
    }),
    createActionButton("回复此留言", () => {
      replyForm.messageId.value = msg.id;
      replyForm.content.focus();
    }),
    createActionButton("删除", () => deleteMessage(msg.id), { danger: true })
  );

  item.appendChild(actions);
  return item;
}

async function loadMessages() {
  adminMessageList.textContent = "加载中...";
  try {
    const data = await fetchJSON(`${API_BASE}/admin/messages`);
    state.messages = data.data || [];
    adminMessageList.innerHTML = "";
    if (!state.messages.length) {
      adminMessageList.innerHTML = `<div class="message">暂无留言。</div>`;
      return;
    }
    state.messages.forEach((msg) => {
      adminMessageList.appendChild(renderAdminMessage(msg));
    });
  } catch (err) {
    if (isAuthError(err)) {
      throw err;
    }
    adminMessageList.innerHTML = `<div class="message">加载失败：${err.message}</div>`;
  }
}

function renderProject(project) {
  const item = document.createElement("div");
  item.className = "message";

  const metaRow = document.createElement("div");
  metaRow.className = "meta-row";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `#${project.id} ${project.name}`;

  const status = document.createElement("span");
  status.className = `pill status-${project.is_public ? 1 : 2}`;
  status.textContent = project.is_public ? "公开" : "隐藏";

  metaRow.append(meta, status);

  const summary = document.createElement("div");
  summary.textContent = project.summary || "暂无简介";

  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(
    createActionButton("编辑", () => {
      projectForm.id.value = project.id;
      projectForm.name.value = project.name || "";
      projectForm.summary.value = project.summary || "";
      projectForm.cover_url.value = project.cover_url || "";
      projectForm.external_url.value = project.external_url || "";
      projectForm.sort_order.value = project.sort_order || 0;
      projectForm.is_public.value = project.is_public ? "1" : "0";
      editor.innerHTML = project.content_html || "";
      contentHtml.value = project.content_html || "";
      projectForm.name.focus();
      showToast("项目已加载到编辑表单", "info");
    }),
    createActionButton("删除", () => deleteProject(project.id), { danger: true })
  );

  item.append(metaRow, summary, actions);
  return item;
}

async function loadProjects() {
  projectList.textContent = "加载中...";
  try {
    const data = await fetchJSON(`${API_BASE}/admin/projects`);
    state.projects = data.data || [];
    projectList.innerHTML = "";
    if (!state.projects.length) {
      projectList.innerHTML = `<div class="message">暂无项目。</div>`;
      return;
    }
    state.projects.forEach((project) => {
      projectList.appendChild(renderProject(project));
    });
  } catch (err) {
    if (isAuthError(err)) {
      throw err;
    }
    projectList.innerHTML = `<div class="message">加载失败：${err.message}</div>`;
  }
}

async function loadStats() {
  try {
    const stats = await fetchJSON(`${API_BASE}/admin/stats`);
    if (statsProjects) statsProjects.textContent = stats.total_projects;
    if (statsMessages) statsMessages.textContent = stats.total_messages;
    if (statsPending) statsPending.textContent = stats.pending_messages;
    if (statsToday) statsToday.textContent = stats.today_messages;
  } catch (err) {
    console.error("加载统计数据失败:", err);
  }
}

async function loadAdminData() {
  try {
    await loadStats();
    await loadMessages();
    await loadProjects();
    setLoggedIn(true);
  } catch (err) {
    if (isAuthError(err)) {
      setLoggedIn(false);
      showToast("请先登录管理员账号", "warning");
      return;
    }
    showToast(`加载失败：${err.name}`, "error");
  }
}

function saveSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  savedRange = selection.getRangeAt(0);
}

function restoreSelection() {
  if (!savedRange) return;
  if (editor) editor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

function runCommand(command) {
  restoreSelection();
  if (command === "h2") {
    document.execCommand("formatBlock", false, "h2");
    return;
  }
  if (command === "ul") {
    document.execCommand("insertUnorderedList");
    return;
  }
  if (command === "ol") {
    document.execCommand("insertOrderedList");
    return;
  }
  if (command === "link") {
    const url = prompt("请输入链接地址");
    if (!url) return;
    document.execCommand("createLink", false, url);
    return;
  }
  document.execCommand(command);
}

async function uploadImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/admin/uploads`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    let message = "上传失败";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch (err) {
      message = message;
    }
    throw new Error(message);
  }
  return res.json();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(loginForm).entries());
  try {
    await fetchJSON(`${API_BASE}/admin/login`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast("登录成功", "success");
    setLoggedIn(true);
    await loadAdminData();
  } catch (err) {
    showToast(`登录失败：${err.message}`, "error");
  }
});

replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(replyForm).entries());
  const messageId = payload.messageId?.trim();
  if (!messageId) {
    showToast("请填写留言 ID", "warning");
    return;
  }
  try {
    await fetchJSON(`${API_BASE}/admin/messages/${messageId}/replies`, {
      method: "POST",
      body: JSON.stringify({ content: payload.content }),
    });
    showToast("回复成功", "success");
    replyForm.reset();
    await loadMessages();
  } catch (err) {
    showToast(`回复失败：${err.message}`, "error");
  }
});

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = Object.fromEntries(new FormData(projectForm).entries());
  const id = payload.id?.trim();
  contentHtml.value = editor.innerHTML.trim();

  const requestBody = {
    name: payload.name?.trim(),
    summary: payload.summary?.trim(),
    cover_url: payload.cover_url?.trim(),
    external_url: payload.external_url?.trim(),
    sort_order: Number(payload.sort_order || 0),
    is_public: payload.is_public === "1",
    content_html: contentHtml.value,
  };

  try {
    if (id) {
      await fetchJSON(`${API_BASE}/admin/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify(requestBody),
      });
      showToast("项目更新成功", "success");
    } else {
      await fetchJSON(`${API_BASE}/admin/projects`, {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      showToast("项目创建成功", "success");
    }
    projectForm.reset();
    editor.innerHTML = "";
    contentHtml.value = "";
    await loadProjects();
  } catch (err) {
    showToast(`提交失败：${err.message}`, "error");
  }
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetchJSON(`${API_BASE}/admin/logout`, { method: "POST" });
      showToast("已安全退出", "info");
    } catch (err) {
      // ignore logout errors, still clear UI
    }
    setLoggedIn(false);
  });
}

if (editor) {
  editor.addEventListener("mouseup", saveSelection);
  editor.addEventListener("keyup", saveSelection);
}

if (toolbar) {
  toolbar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const command = target.dataset.cmd;
    if (!command) return;
    event.preventDefault();
    runCommand(command);
  });
}

if (imageUploadBtn && imageUploadInput) {
  imageUploadBtn.addEventListener("click", () => imageUploadInput.click());
  imageUploadInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    showToast("图片上传中...", "info");
    try {
      const data = await uploadImage(file);
      restoreSelection();
      document.execCommand("insertImage", false, data.url);
      showToast("图片已插入编辑器", "success");
    } catch (err) {
      showToast(`图片上传失败：${err.message}`, "error");
    } finally {
      imageUploadInput.value = "";
    }
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

showTab("dashboard");
loadAdminData();
