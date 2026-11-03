//
// These pages are served from localhost during OAuth and are the last thing a
// user sees before returning to their terminal, so they are self-contained: no
// webfonts, no external assets, nothing that needs the network. They also name
// the host rather than hardcoding "Pi", so a distribution that rebrands pi
// (arc, tau, …) does not send its users back to an app they are not running.

/** Shared chrome: system fonts, a centred card, and light/dark support. */
const PAGE_STYLE = `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #0f1117;
      color: #e6e8ee;
    }
    .card {
      width: 100%;
      max-width: 26rem;
      padding: 2.5rem 2rem;
      text-align: center;
      background: #161922;
      border: 1px solid #242938;
      border-radius: 14px;
      box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 32px rgba(0,0,0,.25);
    }
    .badge {
      width: 3rem; height: 3rem;
      margin: 0 auto 1.25rem;
      display: grid; place-items: center;
      border-radius: 50%;
    }
    .badge svg { width: 1.5rem; height: 1.5rem; display: block; }
    .ok   { background: rgba(74,222,128,.12); color: #4ade80; }
    .bad  { background: rgba(248,113,113,.12); color: #f87171; }
    h1 { margin: 0 0 .5rem; font-size: 1.15rem; font-weight: 600; letter-spacing: -0.01em; }
    p  { margin: 0; color: #9aa1b1; }
    .app { color: #e6e8ee; font-weight: 500; }
    .hint { margin-top: 1.25rem; font-size: .8125rem; color: #6b7280; }
    code {
      display: block;
      margin-top: 1.25rem;
      padding: .75rem .875rem;
      text-align: left;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #fca5a5;
      background: rgba(248,113,113,.08);
      border: 1px solid rgba(248,113,113,.2);
      border-radius: 8px;
      overflow-wrap: anywhere;
    }
    @media (prefers-color-scheme: light) {
      body { background: #f6f7f9; color: #121620; }
      .card { background: #fff; border-color: #e4e7ee; }
      p { color: #5b6474; }
      .app { color: #121620; }
      .hint { color: #8b93a3; }
    }`

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

const CROSS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

function page(options: {
  title: string
  heading: string
  body: string
  icon: string
  tone: "ok" | "bad"
  extra?: string
  autoClose?: boolean
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${options.title}</title>
  <style>${PAGE_STYLE}
  </style>
</head>
<body>
  <main class="card">
    <div class="badge ${options.tone}">${options.icon}</div>
    <h1>${options.heading}</h1>
    <p>${options.body}</p>
    ${options.extra ?? ""}
  </main>
${options.autoClose ? "  <script>setTimeout(() => window.close(), 2000);</script>\n" : ""}</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Render using the host name resolved for this request. */
export function htmlSuccess(appName: string): string {
  const app = escapeHtml(appName)
  return page({
    title: `${app} — Authorization Successful`,
    heading: "Authorization Successful",
    body: `You can close this window and return to <span class="app">${app}</span>.`,
    icon: CHECK_ICON,
    tone: "ok",
    autoClose: true,
  })
}

export function htmlManualSuccess(appName: string): string {
  const app = escapeHtml(appName)
  return page({
    title: `${app} — Authorization Received`,
    heading: "Authorization Received",
    body: `Copy the full callback URL from your browser address bar and paste it back into <span class="app">${app}</span> with auth-complete.`,
    icon: CHECK_ICON,
    tone: "ok",
  })
}

export function htmlError(appName: string, error: string): string {
  const app = escapeHtml(appName)
  return page({
    title: `${app} — Authorization Failed`,
    heading: "Authorization Failed",
    body: `Something went wrong during authorization. You can close this window and try again from <span class="app">${app}</span>.`,
    icon: CROSS_ICON,
    tone: "bad",
    extra: `<code>${escapeHtml(error)}</code>`,
  })
}
