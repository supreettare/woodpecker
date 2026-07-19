// SVG chess pieces. Rendered as inline SVG (not Unicode glyphs) so they look
// identical on every device — in particular iOS Safari renders the U+265F
// pawn glyph as a fixed-color emoji that ignores CSS color, which made white
// pawns appear black. SVG avoids that entirely and scales to fill the square.
//
// Each piece body uses fill="currentColor" so the .cb-white / .cb-black class
// on the wrapper controls colour; a fixed dark stroke gives a clean outline.

const BODY = {
  // Pawn: head + flared body + base.
  p: `<circle cx="22.5" cy="12.5" r="6"/>
      <path d="M16 32 C16 25 19.5 23 22.5 18.5 C25.5 23 29 25 29 32 Z"/>
      <rect x="12.5" y="30.5" width="20" height="4.8" rx="2.2"/>`,
  // Rook: battlements + tapered body + base.
  r: `<path d="M12.5 14.5 v-5 h3.2 v2 h3.2 v-2 h3.2 v2 h3.2 v-2 h3.2 v5 z"/>
      <path d="M14 18.6 l1.4 12.4 h14.2 l1.4 -12.4 z"/>
      <rect x="12.5" y="14.2" width="20" height="4.6"/>
      <rect x="11" y="31" width="23" height="4.4" rx="1.4"/>`,
  // Bishop: mitre + collar + base, with a slit.
  b: `<ellipse cx="22.5" cy="33" rx="10.5" ry="3.1"/>
      <path d="M18 27.5 h9 v3.5 h-9 z"/>
      <path d="M22.5 9.5 C27.5 14 28.5 19 25.5 24 H19.5 C16.5 19 17.5 14 22.5 9.5 Z"/>
      <circle cx="22.5" cy="8" r="2.2"/>
      <path d="M22.5 14 v6 M19.5 17 h6" fill="none" stroke-width="1.3"/>`,
  // Knight: horse-head silhouette + base.
  n: `<path d="M22 10 C31 11 35 17 35 27 V32.5 H15.5 C15.5 27 19.5 24.5 22.5 21.8
        C18.5 24 14.5 22 13.6 19 C12.6 21 10.4 21 9.4 19 C10.4 16 12.4 15 14.4 15
        C14.4 12 17 10 22 10 Z"/>
      <circle cx="27" cy="18.5" r="1.4" fill="#0d0d0d" stroke="none"/>
      <rect x="14" y="32" width="21" height="3.4" rx="1.2"/>`,
  // Queen: five-ball crown + body + base.
  q: `<circle cx="9.5" cy="15" r="2.4"/><circle cx="16.5" cy="11.5" r="2.4"/>
      <circle cx="22.5" cy="10" r="2.6"/><circle cx="28.5" cy="11.5" r="2.4"/>
      <circle cx="35.5" cy="15" r="2.4"/>
      <path d="M11.5 30 C10.5 24 11 19.5 13 16.5 L18 22 L22.5 13.5 L27 22 L32 16.5
        C34 19.5 34.5 24 33.5 30 Z"/>
      <rect x="12" y="29.5" width="21" height="4.4" rx="1.4"/>`,
  // King: cross + crown shoulders + body + base.
  k: `<path d="M22.5 5 V12 M19 8.2 H26" fill="none" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M13 30 C12 24 12.5 19.5 14.5 17 H30.5 C32.5 19.5 33 24 32 30 Z"/>
      <path d="M14 17.5 C18 13 27 13 31 17.5 Z"/>
      <rect x="11.5" y="29.5" width="22" height="4.6" rx="1.4"/>`,
};

export function pieceSVG(type) {
  return `<svg class="cb-svg" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">
    <g fill="currentColor" stroke="#141414" stroke-width="1.4"
       stroke-linejoin="round" stroke-linecap="round">${BODY[type]}</g>
  </svg>`;
}
