// ─── Graph Webview Entry Script ───────────────────────────────────────────────

import type { H2GMessage, G2HMessage } from "../../src/ui/messageProtocol";
import { GraphRenderer } from "./GraphRenderer";

declare function acquireVsCodeApi(): {
  postMessage(message: G2HMessage): void;
};

const vscode = acquireVsCodeApi();
const svgEl = document.getElementById("svg-graph") as unknown as SVGSVGElement;
const renderer = new GraphRenderer(svgEl);

window.addEventListener("message", (event: MessageEvent<H2GMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "graph.data":
      renderer.render(
        msg.data,
        (sha) => vscode.postMessage({ type: "graph.commitClick", sha }),
        (sha, action) => vscode.postMessage({ type: "graph.contextMenu", sha, action }),
      );
      break;
  }
});

// Signal ready to extension host
vscode.postMessage({ type: "ready" });
