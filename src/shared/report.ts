/**
 * "Laporkan" flow. aduankonten.id is a real government service with no prefill API, and every
 * submission is reviewed by a person, so we never auto-submit: we copy a ready-made report to
 * the clipboard and open the portal; the user pastes and submits it themselves.
 */
export const ADUAN_URL = "https://aduankonten.id/";

export interface ReportInput {
  /** URL of the gambling site, or of the page where the promotion appeared. */
  url: string;
  /** What was found (comment text, banner alt text…), optional. */
  evidence?: string;
  /** Where it was seen, e.g. "komentar YouTube". */
  where?: string;
}

/** Strip query/fragment tracking noise but keep the path (it identifies the page). */
export function cleanReportUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|si$|pp$|feature$)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return "";
  }
}

export function reportText(r: ReportInput, now = new Date()): string {
  const lines = [
    "Kategori: Perjudian",
    `Tautan: ${cleanReportUrl(r.url) || r.url}`,
    r.where ? `Ditemukan di: ${r.where}` : "",
    r.evidence ? `Isi konten: "${r.evidence.replace(/\s+/g, " ").trim().slice(0, 300)}"` : "",
    `Waktu: ${now.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}`,
    "Keterangan: Konten mempromosikan situs judi online. (Dilaporkan dengan bantuan Anti-Judol Shield)",
  ];
  return lines.filter(Boolean).join("\n");
}
