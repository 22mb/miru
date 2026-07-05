// Browser entry point: mount the review panel into its own root so it never collides
// with the reviewed document's markup. A Suspense boundary catches the initial
// /api/comments fetch read via `use()` inside useComments. The promise is created
// here (outside the boundary) and passed down — if it lived inside <App>, Suspense
// would unmount on the first throw, the inner `useState` initializer would re-run
// on remount, and we'd loop forever creating fresh pending promises.
import { Component, type ReactNode, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api.ts";
import { App } from "./App.tsx";
import { consumePreReloadText, diffRange, DOC, docText } from "./dom.ts";
import { popoverRef } from "./hooks.ts";
import panelCss from "./panel.css" with { type: "text" };

const initialCommentsPromise = api.listComments();

// Consume the pre-reload snapshot (see reloadWithSnapshot in hooks.ts) at module scope,
// not in an App effect: the read is single-shot and non-idempotent (read-and-clear), so
// its correct scope is "once per page load", not "once per mount" — inside an effect, a
// remount (StrictMode's double-mount, tests) would consume it on the throwaway pass and
// permanently lose the "what changed" flash. The bundle is a deferred script, so the
// document text is fully parsed by now.
const preReloadText = consumePreReloadText();
const changedRange = preReloadText === null ? null : diffRange(preReloadText, docText(DOC()));

// Failure wall between the panel and the page: if the initial fetch rejects through
// `use()` (server gone between page load and fetch, token mismatch) or App throws while
// rendering, React unmounts everything inside the boundary — without one, the reviewer
// gets a document with no panel and no explanation outside the console. A class
// component because error boundaries still have no hook equivalent. Reuses the toast's
// top-layer styling so the message is visible regardless of scroll position.
class PanelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="miru-toast" popover="manual" ref={popoverRef} role="alert">
        miru panel failed to load — is the server still running? Reload to retry.
      </div>
    );
  }
}

const mount = document.createElement("div");
mount.id = "miru-root";
document.body.appendChild(mount);
// The panel renders inside a shadow root: unlayered document CSS beats every light-DOM
// @layer (see the miru.css header), so a shadow boundary is the only thing that keeps a
// reviewed document's <style> from restyling or spoofing the panel. Styles ship inside
// the JS bundle (text import) as a constructed sheet — no extra route, no FOUC.
// Document-level listeners see events from in here retargeted to the #miru-root host;
// handlers that need the real target use composedPath() (hooks.ts, App.tsx).
const shadow = mount.attachShadow({ mode: "open" });
const sheet = new CSSStyleSheet();
sheet.replaceSync(panelCss);
shadow.adoptedStyleSheets = [sheet];
const container = document.createElement("div");
shadow.appendChild(container);
// StrictMode is dev-build-only double-invocation insurance for the effect-heavy hooks
// (subscriptions, imperative paints); the production bundle makes it a no-op.
createRoot(container).render(
  <StrictMode>
    <PanelErrorBoundary>
      <Suspense fallback={null}>
        <App initialCommentsPromise={initialCommentsPromise} changedRange={changedRange} />
      </Suspense>
    </PanelErrorBoundary>
  </StrictMode>,
);
