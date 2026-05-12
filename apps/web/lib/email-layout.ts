import 'server-only';

/**
 * Shared email layout — every Vera email (backfill success/failure,
 * daily/weekly/monthly briefs, future ops) wraps its body with this
 * helper. Guarantees a single source of truth for:
 *
 *   • Vera avatar + "Vera Calloway · Lead AR Intelligence" header in
 *     the warm cream surface
 *   • Display-serif treatment for Calloway's name (Georgia fallback
 *     because Fraunces won't load in most email clients without explicit
 *     web-font headers most clients strip)
 *   • Consistent typography, spacing, and footer
 *   • An optional preheader (inbox preview text) so notification subjects
 *     don't have to do double duty
 *
 * Animation note: most email clients (Gmail, Outlook, every Microsoft
 * surface) strip CSS animations and `<style>` blocks. Only Apple Mail
 * reliably honors SMIL/keyframes. We render a static avatar here. If we
 * later want the in-app `vera-avatar-idle` pulse, the only universal route
 * is an animated GIF baked offline and hosted at a public URL — flagged
 * for V2.
 */

export interface EmailLayoutOptions {
  /** Hidden text shown in the inbox preview (the line under the subject). */
  preheader?: string;
  /** Small uppercase label above the headline. Default 'Vera · update'. */
  eyebrow?: string;
  /** Big display-serif heading. */
  headline: string;
  /** Short paragraph between the headline and the body. */
  introHtml?: string;
  /** The caller's HTML body — already-rendered, no template substitution. */
  bodyHtml: string;
  /** Optional call-to-action link rendered as a styled button. */
  cta?: { href: string; label: string };
  /** Optional override for the footer subline. Default: "Vera Calloway · Priority Roofs". */
  footerSubline?: string;
  /** Optional kicker color override (heat-critical red for failure emails, etc.). */
  eyebrowColor?: string;
}

// Avatar strategy: hosted at /vera-avatar.png on the deployed app. In
// production Gmail's image proxy fetches it once and caches per recipient.
// In local dev (NEXTAUTH_URL=http://localhost:3000) the proxy can't reach
// the host, so Gmail falls back to the alt text — that's expected.
function getAvatarUrl(): string {
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/vera-avatar.png`;
}

const COLORS = {
  bgBase: '#FAF6EE',
  bgCard: '#FFFFFF',
  bgPanel: '#F3EBDE',
  textPrimary: '#1F1B16',
  textSecondary: '#5A4F40',
  textMuted: '#8A7E6E',
  border: '#E5DDD0',
  accent: '#C8854E',
  accentDark: '#B07A44',
  heatCritical: '#A14535',
};

/**
 * Vera header — table-based for compatibility (Outlook + Apple Mail +
 * Gmail all render tables identically; flexbox is unreliable in email).
 *
 * Avatar strategy: the real /vera-avatar.png is hosted on the deployed
 * Vera URL and loaded via <img>. When the image loads (the common case —
 * Resend's verified-domain mail is rarely image-blocked), recipients see
 * the same avatar as the in-app sidebar. If a client DOES block external
 * images, the styled gradient background on the table cell plus the bold
 * "V" text fallback inside still renders — they'll see the orange circle
 * with V, matching the in-app VeraAvatarFallback.
 *
 * Why no animation: every major email client (Gmail, Outlook, Apple Mail,
 * Yahoo, Proton) strips <style> blocks and ignores @keyframes / SMIL
 * almost universally. Animated GIF is the only motion format that works
 * everywhere — that's an offline-generated asset, tracked as V2.
 *
 * Why we don't inline-base64 the PNG: 107 KB → ~145 KB inlined, on every
 * email Vera ever sends. The hosted URL is one network fetch per recipient
 * + browser cache hit on subsequent emails.
 */
function renderHeader(): string {
  const avatarSrc = getAvatarUrl();
  return `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 22px 0;">
  <tr>
    <td width="48" style="vertical-align:middle;padding:0 14px 0 0;width:48px;">
      <!-- Avatar cell: gradient bg + V fallback shows if image is blocked or
           failing to load. <img> sits on top when it loads. -->
      <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accentDark} 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.25);text-align:center;line-height:48px;font-size:0;overflow:hidden;">
        <img
          src="${avatarSrc}"
          width="48"
          height="48"
          alt="V"
          style="display:block;width:48px;height:48px;border-radius:50%;object-fit:cover;border:0;outline:none;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;color:#FFFFFF;line-height:48px;text-align:center;text-decoration:none;background:transparent;"
        />
      </div>
    </td>
    <td style="vertical-align:middle;">
      <p style="margin:0;font-family:Georgia, 'Times New Roman', serif;font-size:18px;font-weight:500;color:${COLORS.textPrimary};letter-spacing:-0.005em;line-height:1.2;">Vera Calloway</p>
      <p style="margin:3px 0 0 0;font-size:10.5px;font-weight:600;color:${COLORS.textMuted};text-transform:uppercase;letter-spacing:1.6px;">Lead AR Intelligence</p>
    </td>
  </tr>
</table>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const eyebrowColor = opts.eyebrowColor ?? COLORS.textMuted;
  const eyebrowText = opts.eyebrow ?? 'Vera · update';
  const footer = opts.footerSubline ?? 'Vera Calloway · Priority Roofs';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(opts.headline)}</title>
  </head>
  <body style="margin:0;padding:24px;background:${COLORS.bgBase};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${COLORS.textPrimary};">
    ${
      opts.preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${COLORS.bgBase};">${escapeHtml(opts.preheader)}</div>`
        : ''
    }
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="max-width:600px;margin:0 auto;">
      <tr>
        <td style="background:${COLORS.bgCard};border:1px solid ${COLORS.border};border-radius:14px;padding:32px;">
          ${renderHeader()}
          <p style="margin:0 0 6px 0;font-size:10.5px;font-weight:600;color:${eyebrowColor};text-transform:uppercase;letter-spacing:1.6px;">${escapeHtml(eyebrowText)}</p>
          <h1 style="margin:0 0 14px 0;font-family:Georgia, 'Times New Roman', serif;font-size:24px;font-weight:500;letter-spacing:-0.3px;line-height:1.2;color:${COLORS.textPrimary};">${escapeHtml(opts.headline)}</h1>
          ${
            opts.introHtml
              ? `<p style="margin:0 0 18px 0;font-size:14px;line-height:1.55;color:${COLORS.textSecondary};">${opts.introHtml}</p>`
              : ''
          }
          ${opts.bodyHtml}
          ${
            opts.cta
              ? `<p style="margin:22px 0 0 0;">
                  <a href="${escapeHtml(opts.cta.href)}" style="display:inline-block;background:${COLORS.accent};color:#FFFFFF;font-weight:500;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:13px;letter-spacing:0.01em;">${escapeHtml(opts.cta.label)}</a>
                </p>`
              : ''
          }
          <hr style="border:none;border-top:1px solid ${COLORS.border};margin:24px 0 18px 0;" />
          <p style="margin:0;font-size:11px;color:${COLORS.textMuted};letter-spacing:0.02em;">${escapeHtml(footer)}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Helper: render a key/value summary table used by both success and
 * failure emails. Pass `[[label, value], ...]` and get a styled
 * table-row HTML string you can drop into `bodyHtml`.
 */
export function renderSummaryTable(rows: Array<[string, string]>): string {
  const tr = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:9px 12px;border-bottom:1px solid ${COLORS.border};color:${COLORS.textMuted};font-size:12.5px;width:42%;">${escapeHtml(label)}</td>
          <td style="padding:9px 12px;border-bottom:1px solid ${COLORS.border};color:${COLORS.textPrimary};font-size:12.5px;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('');
  return `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="border:1px solid ${COLORS.border};border-radius:8px;background:${COLORS.bgPanel};border-collapse:separate;">
  ${tr}
</table>`;
}

export { COLORS as EMAIL_COLORS, escapeHtml as escapeEmailHtml };
