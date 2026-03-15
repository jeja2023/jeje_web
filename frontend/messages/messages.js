// 留言板脚本 / Messages Script
import { API_BASE, fetchJSON, formatDate, showToast } from "/globals/global.js";

const list = document.getElementById("messageList");
const form = document.getElementById("messageForm");
const captchaQuestion = document.getElementById("captchaQuestion");
const captchaRefresh = document.getElementById("captchaRefresh");
const captchaId = document.getElementById("captchaId");

let captchaLoading = false;

function renderMessage(msg) {
  const item = document.createElement("div");
  item.className = "message";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${msg.nickname} · ${formatDate(msg.created_at)}`;

  const content = document.createElement("div");
  content.textContent = msg.content;

  item.append(meta, content);

  if (msg.replies && msg.replies.length) {
    msg.replies.forEach((reply) => {
      const replyEl = document.createElement("div");
      replyEl.className = "reply";
      const strong = document.createElement("strong");
      strong.textContent = "管理员回复：";
      replyEl.append(strong, document.createTextNode(` ${reply.content}`));
      item.appendChild(replyEl);
    });
  }
  return item;
}

async function loadMessages() {
  try {
    const data = await fetchJSON(`${API_BASE}/messages`);
    const messages = data.data || [];
    list.innerHTML = "";
    if (!messages.length) {
      list.innerHTML = `<div class="message">暂无留言。</div>`;
      return;
    }
    messages.forEach((msg) => list.appendChild(renderMessage(msg)));
  } catch (err) {
    list.innerHTML = `<div class="message">加载失败：${err.message}</div>`;
  }
}

async function loadCaptcha() {
  if (captchaLoading) return;
  captchaLoading = true;
  try {
    const data = await fetchJSON(`${API_BASE}/captcha`);
    captchaQuestion.textContent = data.question || "请完成验证";
    captchaId.value = data.id || "";
  } catch (err) {
    captchaQuestion.textContent = `验证码加载失败：${err.message}`;
    captchaId.value = "";
  } finally {
    captchaLoading = false;
  }
}

if (captchaRefresh) {
  captchaRefresh.addEventListener("click", loadCaptcha);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!captchaId.value) {
    showToast("验证码未加载，请重试", "warning");
    await loadCaptcha();
    return;
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    await fetchJSON(`${API_BASE}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast("提交成功，等待审核", "success");
    form.reset();
    await loadCaptcha();
  } catch (err) {
    showToast(`提交失败：${err.message}`, "error");
    await loadCaptcha();
  }
});

loadMessages();
loadCaptcha();
