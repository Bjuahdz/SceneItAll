// ── Glass ticket palette ─────────────────────────────────────────────────────
// Reference vibe: plain BlurView + a slight dark tint. Real side notches are
// cut via one MaskedView silhouette (not stacked slices), so scroll stays seamless.
// Type is plain white — no cool cast, no accent washes on the stock itself.

/** Slight dark tint over the blur. Keep it quiet. */
export const TICKET_GLASS_TINT = 'rgba(33, 31, 31, 0.49)';

/** Near-opaque fallback when a child needs to match the sheet. */
export const TICKET_SURFACE = 'rgba(8, 8, 10, 0.88)';

/** @deprecated Prefer TICKET_SURFACE / TICKET_GLASS_TINT. */
export const TICKET_IVORY = TICKET_SURFACE;

/** Plain white print — matches the reference ticket type. */
export const TICKET_PRINT = '#ffffff';

export const TICKET_INK = TICKET_PRINT;

/** App accent — actions only, not sheet chrome. */
export const TICKET_ACCENT = '#9ccadf';

/** Soft glass edge. */
export const TICKET_RIM = 'rgba(255,255,255,0.10)';

export const ink = (a: number) => `rgba(255,255,255,${a})`;
export const accent = (a: number) => `rgba(156,202,223,${a})`;
export const surface = (a: number) => `rgba(8,8,10,${a})`;

export const INK_GREEN = '#6bcf8e';
export const INK_AMBER = '#e0b35a';
export const INK_RED = '#e87268';
