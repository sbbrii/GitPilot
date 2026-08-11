// ─── Graph Renderer (D3.js) ──────────────────────────────────────────────────
// Renders CommitGraphData using SVG and D3.js. Pure rendering class.
// Supports branch/tag label badges, merge node highlighting, HEAD indicator,
// and right-click context menu for cherry-pick / reset-to / branch-here actions.

import * as d3 from "d3";
import type { CommitGraphData, GraphNode, GraphEdge } from "../../src/graph/types";

const NODE_RADIUS = 6;
const ROW_HEIGHT = 32;
const LANE_WIDTH = 26;
const LABEL_CHAR_WIDTH = 7; // approximate pixel width per character
const LABEL_PADDING = 10;   // horizontal padding inside a badge
const LABEL_HEIGHT = 16;
const PADDING_LEFT = 44;
const PADDING_TOP = 20;
const TEXT_OFFSET_X = LANE_WIDTH * 2;

export type ContextMenuAction = "cherry-pick" | "reset-to" | "branch-here";

export class GraphRenderer {
  private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;

  constructor(svgElement: SVGSVGElement) {
    this.svg = d3.select(svgElement);
    // Suppress default browser context menu on the SVG
    svgElement.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  render(
    data: CommitGraphData,
    onCommitClick?: (sha: string) => void,
    onContextMenu?: (sha: string, action: ContextMenuAction) => void,
  ): void {
    this.svg.selectAll("*").remove();

    if (data.nodes.length === 0) {
      this.svg
        .append("text")
        .attr("x", 20)
        .attr("y", 40)
        .attr("fill", "var(--vscode-foreground)")
        .attr("font-size", "13px")
        .text("No commits in repository.");
      return;
    }

    // Resize SVG to fit content
    const totalHeight = PADDING_TOP * 2 + data.nodes.length * ROW_HEIGHT;
    const totalWidth = Math.max(800, PADDING_LEFT + data.laneCount * LANE_WIDTH + 600);
    this.svg.attr("height", totalHeight).attr("width", totalWidth);

    const nodeMap = new Map<string, GraphNode>(data.nodes.map((n) => [n.sha, n]));
    const g = this.svg.append("g");

    // ── Render edges first (drawn behind nodes) ───────────────────────────────
    g.selectAll<SVGPathElement, GraphEdge>(".edge")
      .data(data.edges)
      .enter()
      .append("path")
      .attr("class", "edge")
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2)
      .attr("fill", "none")
      .attr("d", (d) => {
        const source = nodeMap.get(d.fromSha);
        const target = nodeMap.get(d.toSha);
        if (!source || !target) return "";

        const x1 = PADDING_LEFT + source.lane * LANE_WIDTH;
        const y1 = PADDING_TOP + source.y * ROW_HEIGHT;
        const x2 = PADDING_LEFT + target.lane * LANE_WIDTH;
        const y2 = PADDING_TOP + target.y * ROW_HEIGHT;

        // Straight line for same-lane edges; cubic bezier for cross-lane
        if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
        const midY = (y1 + y2) / 2;
        return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      });

    // ── Render commit node groups ─────────────────────────────────────────────
    const nodesG = g
      .selectAll<SVGGElement, GraphNode>(".node-group")
      .data(data.nodes)
      .enter()
      .append("g")
      .attr("class", "node-group")
      .attr(
        "transform",
        (d) =>
          `translate(${PADDING_LEFT + d.lane * LANE_WIDTH}, ${PADDING_TOP + d.y * ROW_HEIGHT})`,
      )
      .style("cursor", "pointer")
      .on("click", (_event, d) => onCommitClick?.(d.sha));

    // ── Context menu (right-click) ────────────────────────────────────────────
    if (onContextMenu) {
      nodesG.on("contextmenu", (event: MouseEvent, d) => {
        event.preventDefault();
        event.stopPropagation();
        this.showContextMenu(event, d.sha, onContextMenu);
      });
    }

    // Commit circle
    nodesG
      .append("circle")
      .attr("class", "commit-node")
      .attr("r", (d) => (d.isHead ? NODE_RADIUS + 2 : NODE_RADIUS))
      .attr("fill", (d) => {
        if (d.isHead) return "#f0883e";
        if (d.isMerge) return "#bc8cff";
        return data.branchColors[d.branchLabels[0] ?? ""] ?? "#58a6ff";
      })
      .attr("stroke", (d) => (d.isHead ? "#fff" : "none"))
      .attr("stroke-width", (d) => (d.isHead ? 2 : 0));

    // HEAD indicator diamond
    nodesG
      .filter((d) => d.isHead)
      .append("text")
      .attr("x", 0)
      .attr("y", -NODE_RADIUS - 4)
      .attr("text-anchor", "middle")
      .attr("fill", "#f0883e")
      .attr("font-size", "10px")
      .text("HEAD");

    // Commit text: shortSha + message
    nodesG
      .append("text")
      .attr("x", TEXT_OFFSET_X)
      .attr("y", 4)
      .attr("fill", "var(--vscode-editor-foreground)")
      .attr("font-size", "12px")
      .attr("font-family", "var(--vscode-editor-font-family, monospace)")
      .text((d) => `${d.shortSha}  ${truncate(d.message, 72)}`);

    // Author + timestamp (dimmed)
    nodesG
      .append("text")
      .attr("x", TEXT_OFFSET_X)
      .attr("y", 16)
      .attr("fill", "var(--vscode-descriptionForeground)")
      .attr("font-size", "10px")
      .text((d) => `${d.author} · ${formatTimestamp(d.timestamp)}`);

    // ── Branch + tag label badges ─────────────────────────────────────────────
    nodesG.each(function (d) {
      if (d.branchLabels.length === 0 && d.tagLabels.length === 0) return;

      const el = d3.select(this);
      // Start offset: after short sha + message text column
      const msgLen = Math.min(d.message.length, 72);
      let offsetX = TEXT_OFFSET_X + (d.shortSha.length + msgLen + 3) * LABEL_CHAR_WIDTH + 8;

      const renderBadge = (label: string, fillColor: string, textColor: string) => {
        const badgeWidth = label.length * LABEL_CHAR_WIDTH + LABEL_PADDING;
        const badgeG = el.append("g").attr("transform", `translate(${offsetX}, -9)`);
        badgeG
          .append("rect")
          .attr("class", "label-badge")
          .attr("width", badgeWidth)
          .attr("height", LABEL_HEIGHT)
          .attr("fill", fillColor)
          .attr("rx", 3)
          .attr("ry", 3);
        badgeG
          .append("text")
          .attr("x", LABEL_PADDING / 2)
          .attr("y", 12)
          .attr("fill", textColor)
          .attr("font-size", "10px")
          .attr("font-weight", "bold")
          .text(label);
        offsetX += badgeWidth + 4;
      };

      // Branch labels — green badges
      for (const label of d.branchLabels) {
        renderBadge(label, "#238636", "#ffffff");
      }

      // Tag labels — amber/gold badges (visually distinct from branches)
      for (const label of d.tagLabels) {
        renderBadge(`🏷 ${label}`, "#9e6a03", "#ffffff");
      }
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private showContextMenu(
    event: MouseEvent,
    sha: string,
    onContextMenu: (sha: string, action: ContextMenuAction) => void,
  ): void {
    // Remove any existing context menus
    document.querySelectorAll(".graph-context-menu").forEach((el) => el.remove());

    const menu = document.createElement("div");
    menu.className = "graph-context-menu";
    menu.style.cssText = [
      `position: fixed`,
      `left: ${event.clientX}px`,
      `top: ${event.clientY}px`,
      `background: var(--vscode-menu-background, #252526)`,
      `color: var(--vscode-menu-foreground, #cccccc)`,
      `border: 1px solid var(--vscode-menu-border, #454545)`,
      `border-radius: 4px`,
      `padding: 4px 0`,
      `min-width: 180px`,
      `z-index: 9999`,
      `box-shadow: 0 4px 12px rgba(0,0,0,0.4)`,
      `font-size: 13px`,
      `font-family: var(--vscode-font-family)`,
    ].join("; ");

    const actions: Array<{ label: string; action: ContextMenuAction }> = [
      { label: "🍒  Cherry-pick this commit", action: "cherry-pick" },
      { label: "↩️  Reset HEAD to here", action: "reset-to" },
      { label: "🌿  Create branch here", action: "branch-here" },
    ];

    for (const { label, action } of actions) {
      const item = document.createElement("div");
      item.textContent = label;
      item.style.cssText = "padding: 6px 12px; cursor: pointer;";
      item.addEventListener("mouseenter", () => {
        item.style.background = "var(--vscode-menu-selectionBackground, #094771)";
        item.style.color = "var(--vscode-menu-selectionForeground, #ffffff)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "";
        item.style.color = "";
      });
      item.addEventListener("click", () => {
        menu.remove();
        onContextMenu(sha, action);
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);

    // Close the menu on next click anywhere
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", close, true);
      }
    };
    // Delay to avoid the current click event closing it immediately
    setTimeout(() => document.addEventListener("click", close, true), 50);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen - 1)}…` : str;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
