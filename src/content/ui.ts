/**
 * DOM marking. We only touch data-attributes + one small badge element per flagged container;
 * all visuals (blur/hide) live in content.css so the browser applies them in one style pass.
 * No innerHTML anywhere (YouTube enforces Trusted Types).
 */
import type { Action } from "../shared/settings";
import type { VerdictSource } from "../shared/verdict";

export type MarkState = "judol" | "suspicious" | "pending";

export interface Mark {
  state: MarkState;
  action: Action;
  key: string;
  source: VerdictSource;
}

const LABEL: Record<MarkState, string> = {
  judol: "⚠ Promosi judol",
  suspicious: "⚠ Spam mencurigakan",
  pending: "Memeriksa…",
};

export const BADGE = "aj-badge";
const ATTRS = ["data-aj-state", "data-aj-action", "data-aj-key", "data-aj-source", "data-aj-revealed"] as const;

function button(doc: Document, act: string, text: string, label: string): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.dataset.ajAct = act;
  b.textContent = text;
  b.setAttribute("aria-label", label);
  return b;
}

function ensureBadge(el: Element): HTMLElement {
  for (const c of el.children) if (c.classList.contains(BADGE)) return c as HTMLElement;
  const doc = el.ownerDocument;
  const badge = doc.createElement("span");
  badge.className = BADGE;
  badge.setAttribute("role", "note");
  const label = doc.createElement("span");
  label.className = "aj-label";
  badge.append(
    label,
    button(doc, "reveal", "Lihat", "Tampilkan konten yang disembunyikan"),
    button(doc, "allow", "Bukan judol", "Tandai bukan judol dan jangan sembunyikan lagi"),
    button(doc, "report", "Laporkan", "Laporkan ke aduankonten.id (Komdigi)"),
  );
  el.append(badge);
  return badge;
}

export function applyMark(el: Element, m: Mark): void {
  // Skip no-op writes: attribute churn would re-trigger style recalculation.
  if (el.getAttribute("data-aj-state") !== m.state) el.setAttribute("data-aj-state", m.state);
  if (el.getAttribute("data-aj-action") !== m.action) el.setAttribute("data-aj-action", m.action);
  if (el.getAttribute("data-aj-key") !== m.key) {
    el.setAttribute("data-aj-key", m.key);
    el.removeAttribute("data-aj-revealed");
  }
  el.setAttribute("data-aj-source", m.source);
  const badge = ensureBadge(el);
  const label = badge.querySelector(".aj-label");
  if (label && label.textContent !== LABEL[m.state]) label.textContent = LABEL[m.state];
  const title = m.source === "jev" || m.source === "cache" ? "Deteksi: Jev AI" : "Deteksi: filter lokal";
  badge.title = `${title} · klik konten untuk melihat`;
}

export function clearMark(el: Element): void {
  if (!el.hasAttribute("data-aj-state")) return;
  for (const a of ATTRS) el.removeAttribute(a);
  for (const c of [...el.children]) if (c.classList.contains(BADGE)) c.remove();
}

export function clearAll(root: ParentNode): void {
  for (const el of root.querySelectorAll("[data-aj-state]")) clearMark(el);
}

export function isOurs(n: Node): boolean {
  const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
  return !!el?.closest(`.${BADGE}`);
}

/** One delegated capture listener: badge buttons + click-to-reveal on blurred items. */
export interface InteractionHandlers {
  onAllow(key: string, el: Element): void;
  onReport(el: Element): void;
}

export function installInteractions(doc: Document, h: InteractionHandlers): () => void {
  const onClick = (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (!t?.closest) return;
    const btn = t.closest<HTMLElement>(`.${BADGE} button`);
    const host = (btn ?? t).closest("[data-aj-state]");
    if (!host) return;
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.ajAct === "reveal") {
        const on = !host.hasAttribute("data-aj-revealed");
        host.toggleAttribute("data-aj-revealed", on);
        btn.textContent = on ? "Sembunyikan" : "Lihat";
      } else if (btn.dataset.ajAct === "allow") {
        const key = host.getAttribute("data-aj-key");
        if (key) h.onAllow(key, host);
      } else if (btn.dataset.ajAct === "report") {
        h.onReport(host);
        btn.textContent = "Laporan disalin ✓";
      }
      return;
    }
    // First click on a blurred item reveals it instead of opening a (possibly judol) link.
    const blurred =
      host.getAttribute("data-aj-action") !== "badge" &&
      !host.hasAttribute("data-aj-revealed") &&
      !doc.documentElement.hasAttribute("data-aj-reveal-all");
    if (blurred) {
      e.preventDefault();
      e.stopPropagation();
      host.setAttribute("data-aj-revealed", "");
      const rb = host.querySelector<HTMLElement>(`.${BADGE} button[data-aj-act="reveal"]`);
      if (rb) rb.textContent = "Sembunyikan";
    }
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}
