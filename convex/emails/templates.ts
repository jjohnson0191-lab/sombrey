/**
 * Shared GOAT WALK branded email HTML builder.
 * Pure V8 runtime (no "use node" — only string helpers, no Node APIs).
 *
 * All user-provided values must be escaped by callers via escapeHtml()
 * before being passed here.
 */

const BRAND = {
  blue: "#4169E1",
  blueDark: "#2e4fb5",
  black: "#0a0a0a",
  card: "#111111",
  cardBorder: "#222222",
  muted: "#888888",
  mutedDark: "#555555",
  subtle: "#333333",
  white: "#ffffff",
  offWhite: "#cccccc",
  gunmetal: "#1e2028",
  gunmetalBorder: "#2a2d38",
  danger: "#e53e3e",
} as const;

/**
 * Wraps any email body content in the standard GOAT WALK shell.
 * @param title      — shown in the header
 * @param eyebrow    — small label above title (e.g. "WELCOME" / "SUBSCRIPTION")
 * @param bodyHtml   — inner HTML content
 * @param footerNote — optional extra footer text
 */
export function buildEmailHtml({
  title,
  eyebrow,
  bodyHtml,
  footerNote,
}: {
  title: string;
  eyebrow: string;
  bodyHtml: string;
  footerNote?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.black};font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.black};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:540px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.gunmetal} 0%,${BRAND.black} 100%);
                       padding:28px 32px 24px;
                       border:1px solid ${BRAND.gunmetalBorder};
                       border-bottom:2px solid ${BRAND.blue};
                       border-radius:16px 16px 0 0;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:${BRAND.blue};font-weight:700;">
                GOAT WALK &nbsp;·&nbsp; ${eyebrow}
              </p>
              <h1 style="margin:0;font-size:26px;font-weight:800;color:${BRAND.white};line-height:1.2;letter-spacing:-0.3px;">
                ${title}
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:${BRAND.card};padding:32px;border-left:1px solid ${BRAND.cardBorder};border-right:1px solid ${BRAND.cardBorder};">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0d0d0d;padding:20px 32px;
                       border:1px solid ${BRAND.subtle};
                       border-top:1px solid #1a1a1a;
                       border-radius:0 0 16px 16px;">
              ${footerNote ? `<p style="margin:0 0 8px;font-size:12px;color:${BRAND.mutedDark};line-height:1.5;text-align:center;">${footerNote}</p>` : ""}
              <p style="margin:0;font-size:11px;color:#3a3a3a;text-align:center;">
                GOAT WALK &mdash; AI Fitness Coaching &nbsp;|&nbsp;
                <a href="https://www.agoatwalk.com" style="color:#3a3a3a;text-decoration:none;">agoatwalk.com</a>
              </p>
              <p style="margin:6px 0 0;font-size:10px;color:#2a2a2a;text-align:center;">
                You received this email because you have a GOAT WALK account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Reusable electric-blue CTA button */
export function ctaButton(label: string, url: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center" style="padding:8px 0 28px;">
      <a href="${url}"
         style="display:inline-block;background:${BRAND.blue};color:${BRAND.white};
                font-size:15px;font-weight:700;text-decoration:none;
                padding:14px 40px;border-radius:10px;letter-spacing:0.3px;">
        ${label}
      </a>
    </td>
  </tr>
</table>`;
}

/** Gunmetal info box (e.g. plan details, ticket info) */
export function infoBox(rows: { label: string; value: string }[]): string {
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #1e1e1e;">
            <span style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#666;">${r.label}</span>
            <br/>
            <span style="font-size:14px;font-weight:600;color:#ddd;margin-top:2px;display:block;">${r.value}</span>
          </td>
        </tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0"
    style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:0 16px;margin-bottom:24px;">
    <tr><td style="padding:4px 0;">${rowsHtml}</td></tr>
  </table>`;
}

/** Standard body text paragraph */
export function para(text: string, muted = false): string {
  const color = muted ? "#777" : "#aaa";
  return `<p style="margin:0 0 16px;font-size:15px;color:${color};line-height:1.7;">${text}</p>`;
}

/** Divider line */
export function divider(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
    <tr><td style="border-top:1px solid #1e1e1e;font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>`;
}

export const SENDER = "GOAT WALK <Admin@app.agoatwalk.com>";
export const APP_URL = "https://www.agoatwalk.com";
