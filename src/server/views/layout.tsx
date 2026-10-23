import { esc } from "../view";

export interface PageChrome {
  /** Nav key this page lights up. */
  active: "home" | "watch" | "recordings" | "admin";
  title: string;
  live: number;
  recording: number;
  bun: string;
}

const NAV = [
  { key: "home", href: "/", label: "Overview", icon: "i-home" },
  { key: "watch", href: "/watch", label: "Watch", icon: "i-eye" },
  {
    key: "recordings",
    href: "/recordings",
    label: "Recordings",
    icon: "i-film",
  },
  { key: "admin", href: "/admin", label: "Admin", icon: "i-sliders" },
] as const;

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%2308090b'/%3E%3Cpath d='M7 22V10m6 12V10m6 12V10m6 12V10' stroke='%23c8f24f' stroke-width='2'/%3E%3C/svg%3E";

function Sprite() {
  return (
    <svg class="sprite" aria-hidden="true" focusable="false">
      <symbol id="i-home" viewBox="0 0 24 24">
        <path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4.2v-6H9.2v6H5a1 1 0 0 1-1-1z" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2.2 12S5.8 5.6 12 5.6 21.8 12 21.8 12 18.2 18.4 12 18.4 2.2 12 2.2 12Z" />
        <circle cx="12" cy="12" r="2.7" />
      </symbol>
      <symbol id="i-film" viewBox="0 0 24 24">
        <rect x="3" y="4.5" width="18" height="15" rx="1.6" />
        <path d="M7.2 4.5v15M16.8 4.5v15M3 9.4h4.2M3 14.6h4.2M16.8 9.4H21M16.8 14.6H21" />
      </symbol>
      <symbol id="i-sliders" viewBox="0 0 24 24">
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
        <circle cx="15" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </symbol>
      <symbol id="i-play" viewBox="0 0 24 24">
        <path d="M8.5 5.4v13.2L19 12z" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-download" viewBox="0 0 24 24">
        <path d="M12 4v11m0 0 4.2-4.2M12 15l-4.2-4.2M5 20h14" />
      </symbol>
      <symbol id="i-trash" viewBox="0 0 24 24">
        <path d="M4 7h16M9.5 7V4.8h5V7M6.8 7l.9 12.2h8.6L17.2 7" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24">
        <path d="M4.3 12a7.7 7.7 0 0 1 13.1-5.4L20 9.2M20 4.4v4.8h-4.8M19.7 12a7.7 7.7 0 0 1-13.1 5.4L4 15M4 19.6v-4.8h4.8" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="m5 12.5 4.6 4.5L19 6.8" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />
      </symbol>
    </svg>
  );
}

function Sidebar(props: PageChrome) {
  return (
    <aside class="sidebar" x-bind:class="{ 'is-open': nav }">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 44 44" role="presentation">
            <path d="M7 30V14M14 34V10M21 27V17M28 33V11M35 28V16" />
          </svg>
        </span>
        <span class="brand-text">
          <strong>tokweb</strong>
          <small>capture console</small>
        </span>
      </div>

      <nav class="nav" aria-label="Primary">
        {NAV.map((item) => (
          <a
            class={`nav-link${item.key === props.active ? " is-active" : ""}`}
            href={item.href}
            aria-current={item.key === props.active ? "page" : undefined}
          >
            <svg class="icon" aria-hidden="true">
              <use href={`#${item.icon}`} />
            </svg>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      <div class="sidebar-foot">
        <div class="side-line">
          <span class="status-dot is-live"></span>
          <span class="side-label">live</span>
          <span class="side-value">{props.live}</span>
        </div>
        <div class="side-line">
          <span class="status-dot is-recording"></span>
          <span class="side-label">recording</span>
          <span class="side-value">{props.recording}</span>
        </div>
        <p class="side-meta">bun {esc(props.bun)} · 127.0.0.1</p>
      </div>
    </aside>
  );
}

function Topbar(props: PageChrome) {
  return (
    <header class="topbar">
      <button
        class="icon-btn nav-toggle"
        type="button"
        x-on:click="nav = !nav"
        x-bind:aria-expanded="nav"
        aria-label="Toggle navigation"
      >
        <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span class="topbar-crumb">
        local capture · <span class="mono">127.0.0.1</span>
      </span>
      <div class="topbar-right">
        {props.recording > 0 ? (
          <span class="pill is-hot">
            <span class="status-dot is-recording"></span>
            {props.recording} recording
          </span>
        ) : (
          <span class="pill">
            <span class="status-dot is-live"></span>
            {props.live} live
          </span>
        )}
        <a class="icon-btn" href="/admin" aria-label="Settings">
          <svg class="icon" aria-hidden="true">
            <use href="#i-sliders" />
          </svg>
        </a>
      </div>
    </header>
  );
}

export function Layout(
  props: PageChrome & { children?: unknown },
): JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#08090b" />
        <title>{esc(props.title)} · tokweb</title>
        <link rel="stylesheet" href="/assets/app.css" />
        <link rel="icon" href={FAVICON} />
        <script defer src="/vendor/htmx.js"></script>
        <script defer src="/vendor/htmx-alpine.js"></script>
        <script defer src="/assets/app.js"></script>
        <script defer src="/vendor/alpine.js"></script>
      </head>
      <body hx-ext="alpine-compat" x-data="{ nav: false }">
        <Sprite />

        <a class="skip" href="#main">
          Skip to content
        </a>

        <div class="app">
          <Sidebar {...props} />

          <div class="main">
            <Topbar {...props} />

            <main class="page" id="main">
              {props.children as JSX.Element}
            </main>

            <footer class="foot">
              <span>tokweb · clean-room capture</span>
              <span>keeps everything on this machine</span>
              <span>record responsibly</span>
            </footer>
          </div>
        </div>

        <div
          class="scrim"
          x-show="nav"
          {...{ "x-transition.opacity": "" }}
          x-on:click="nav = false"
          aria-hidden="true"
        ></div>

        <div class="toasts" aria-live="polite" aria-atomic="false">
          <template x-for="toast in $store.toasts.items" x-bind:key="toast.id">
            <div class="toast" x-bind:class="'is-' + toast.level" role="status">
              <span x-text="toast.message"></span>
            </div>
          </template>
        </div>
      </body>
    </html>
  );
}
