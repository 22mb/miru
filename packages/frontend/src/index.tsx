// Browser entry point: mount the review panel into its own root so it never collides
// with the reviewed document's markup. A Suspense boundary catches the initial
// /api/comments fetch read via `use()` inside useComments. The promise is created
// here (outside the boundary) and passed down — if it lived inside <App>, Suspense
// would unmount on the first throw, the inner `useState` initializer would re-run
// on remount, and we'd loop forever creating fresh pending promises.
import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api.ts";
import { App } from "./App.tsx";

const initialCommentsPromise = api.listComments();

const mount = document.createElement("div");
mount.id = "miru-root";
document.body.appendChild(mount);
createRoot(mount).render(
  <Suspense fallback={null}>
    <App initialCommentsPromise={initialCommentsPromise} />
  </Suspense>,
);
