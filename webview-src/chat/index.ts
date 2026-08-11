// ─── Chat Webview Script ───────────────────────────────────────────────────────
// Browser-side script running in the Chat Webview panel.

import type { H2CMessage, C2HMessage } from "../../src/ui/messageProtocol";

declare function acquireVsCodeApi(): {
  postMessage(message: C2HMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const messagesEl = document.getElementById("messages")!;
const inputEl = document.getElementById("input") as HTMLInputElement;
const sendBtn = document.getElementById("send-btn")!;

let currentAssistantMsgEl: HTMLDivElement | null = null;

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function sendMessage(): void {
  const text = inputEl.value.trim();
  if (!text) return;

  appendUserMessage(text);
  vscode.postMessage({ type: "chat.send", message: text });
  inputEl.value = "";
}

function appendUserMessage(text: string): void {
  const div = document.createElement("div");
  div.className = "msg user";
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function appendAssistantToken(token: string): void {
  if (!currentAssistantMsgEl) {
    currentAssistantMsgEl = document.createElement("div");
    currentAssistantMsgEl.className = "msg assistant";
    messagesEl.appendChild(currentAssistantMsgEl);
  }
  currentAssistantMsgEl.textContent += token;
  scrollToBottom();
}

function renderApprovalRequest(msg: Extract<H2CMessage, { type: "approval.request" }>): void {
  const card = document.createElement("div");
  card.className = `approval-card ${msg.riskLevel}`;
  card.id = `approval-${msg.id}`;

  const header = document.createElement("h4");
  header.textContent = `Approval Required: ${msg.commandDisplay} (${msg.riskLevel.toUpperCase()})`;
  card.appendChild(header);

  if (msg.dryRunOutput) {
    const pre = document.createElement("pre");
    pre.textContent = msg.dryRunOutput;
    card.appendChild(pre);
  }

  if (msg.warnings.length > 0) {
    const ul = document.createElement("ul");
    for (const w of msg.warnings) {
      const li = document.createElement("li");
      li.textContent = w;
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }

  let phraseInput: HTMLInputElement | null = null;
  if (msg.requiresTyped && msg.phrase) {
    const prompt = document.createElement("p");
    prompt.textContent = `Type "${msg.phrase}" to confirm:`;
    card.appendChild(prompt);

    phraseInput = document.createElement("input");
    phraseInput.type = "text";
    phraseInput.placeholder = msg.phrase;
    card.appendChild(phraseInput);
  }

  const actions = document.createElement("div");
  actions.style.marginTop = "8px";

  const approveBtn = document.createElement("button");
  approveBtn.className = "btn";
  approveBtn.textContent = "Approve & Execute";
  approveBtn.onclick = () => {
    const typed = phraseInput ? phraseInput.value.trim() : undefined;
    vscode.postMessage({ type: "approval.granted", id: msg.id, typedPhrase: typed });
    card.remove();
  };

  const denyBtn = document.createElement("button");
  denyBtn.className = "btn btn-deny";
  denyBtn.textContent = "Cancel";
  denyBtn.onclick = () => {
    vscode.postMessage({ type: "approval.denied", id: msg.id });
    card.remove();
  };

  actions.appendChild(approveBtn);
  actions.appendChild(denyBtn);
  card.appendChild(actions);

  messagesEl.appendChild(card);
  scrollToBottom();
}

function scrollToBottom(): void {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

window.addEventListener("message", (event: MessageEvent<H2CMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "chat.token":
      appendAssistantToken(msg.token);
      break;
    case "chat.done":
      currentAssistantMsgEl = null;
      break;
    case "chat.error":
      currentAssistantMsgEl = null;
      const errDiv = document.createElement("div");
      errDiv.className = "msg assistant";
      errDiv.style.color = "var(--vscode-errorForeground)";
      errDiv.textContent = `⚠️ Error: ${msg.message}`;
      messagesEl.appendChild(errDiv);
      scrollToBottom();
      break;
    case "approval.request":
      renderApprovalRequest(msg);
      break;
    case "approval.expired":
      const card = document.getElementById(`approval-${msg.id}`);
      if (card) {
        card.textContent = "⚠️ Approval request expired.";
      }
      break;
  }
});

// Notify host that webview is ready
vscode.postMessage({ type: "ready" });
