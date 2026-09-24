/**
 * Side-effect bootstrap: load the edition bridge in every webview.
 * Pro registers key-sound packs + license gate; community is a no-op stub.
 * Overlay / Power must import this — Panel already pulls it via Skins/UI.
 */
import "@edition-impl/bridge";
