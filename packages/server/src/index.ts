// Public API of @miru/server: the HTTP review server plus the domain helpers the CLI
// builds on (rendering, injection, persistence, file-watching, ids).
export { createServer, type ServeOptions } from "./server.ts";
export {
  CorruptedSidecarError,
  FutureSidecarError,
  loadReview,
  reviewPath,
  saveReview,
  updateReview,
} from "./store.ts";
export type { Anchor, Comment, ElementAnchor, Reply, ReviewFile, TextAnchor } from "./store.ts";
export {
  detectKind,
  renderCommentBody,
  renderDocument,
  type SanitizeTier,
  type SourceKind,
} from "./render.ts";
export { injectUI, wrapIfFragment } from "./inject.ts";
export { watchFile } from "./watch.ts";
export { shortId } from "./id.ts";
