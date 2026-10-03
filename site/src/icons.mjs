// Small stroke icons (24x24, 1.7 stroke). Directional ones carry class "flip" so RTL pages mirror them.
const P = {
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 1.6-1.9-.5-1.2.2-2.4 1.6-2.4h1.6a3.2 3.2 0 0 0 3.2-3.2C20 8 16.5 3.5 12 3.5Z"/><circle cx="8" cy="11" r=".9"/><circle cx="11" cy="7.7" r=".9"/><circle cx="15.2" cy="8.6" r=".9"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/>',
  wand: '<path d="m5 19 9.5-9.5"/><path d="m13 7 4 4"/><path d="M17.5 3.5v2M16.5 4.5h2M20 8v1.6M19.2 8.8h1.6"/>',
  type: '<path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9"/><path d="M5 15v3a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-3"/>',
  text: '<path d="M4 7h16M4 12h10M4 17h13"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  wifi: '<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a7.6 7.6 0 0 1 11 0M9.5 16a3.2 3.2 0 0 1 5 0"/><circle cx="12" cy="19" r=".9"/>',
  usb: '<path d="M12 20V6M12 6l-2 2.2M12 6l2 2.2"/><circle cx="12" cy="20" r="1.5"/><path d="M12 14l-4-2v-2M12 11l4-2v-1.5"/><rect x="6.7" y="7.6" width="2.6" height="2.4"/><circle cx="16.2" cy="6.8" r="1.2"/>',
  list: '<rect x="5" y="4" width="14" height="16" rx="2.5"/><path d="m8.5 9 1.2 1.2L12 8M8.5 15l1.2 1.2L12 14M14 9.2h2M14 15.2h2"/>',
  files: '<path d="M8 3.5h6l4 4v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 16.5v-11A1.5 1.5 0 0 1 8.5 3.5"/><path d="M14 3.5v4h4M5 7v12.5A1.5 1.5 0 0 0 6.5 21H15"/>',
  spool: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><ellipse cx="12" cy="18" rx="7" ry="2.5"/><path d="M5 6v12M19 6v12M8 8.3v7.4M16 8.3v7.4"/>',
  shelf: '<path d="M4 20V6l8-2.5L20 6v14M4 20h16M4 13h16"/>',
  hoop: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/><path d="M12 2.8v1.7"/>',
  ruler: '<rect x="3" y="8" width="18" height="8" rx="2" transform="rotate(-35 12 12)"/><path d="m8.2 11.2 1.4 1.2M10.8 9l1.4 1.2M13.4 6.8l1.4 1.2"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  cross: '<path d="m6 6 12 12M18 6 6 18"/>',
  swap: '<path d="M4 8h14M14.5 4.5 18 8l-3.5 3.5M20 16H6M9.5 12.5 6 16l3.5 3.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5Z"/>',
  heart: '<path d="M12 19.5S4.5 15 4.5 9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7.5 1.6C19.5 15 12 19.5 12 19.5Z"/>',
  code: '<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 6l-3 12"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.7-3.7 3.6-5.5 7-5.5s6.3 1.8 7 5.5"/>',
  offline: '<path d="M3.5 9.5a12 12 0 0 1 3-2M20.5 9.5a12 12 0 0 0-8.5-3.5M6.5 12.8a7.6 7.6 0 0 1 2.4-1.6M17.5 12.8a7.6 7.6 0 0 0-3.4-2M9.5 16a3.2 3.2 0 0 1 5 0"/><circle cx="12" cy="19" r=".9"/><path d="m4 4 16 16"/>',
  send: '<path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4Z"/>',
  arrow: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5Z"/>',
  download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14"/>',
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
};
const FLIP = new Set(["arrow", "send"]);

export function icon(name, { size = 24, cls = "" } = {}) {
  const body = P[name];
  if (!body) throw new Error(`unknown icon: ${name}`);
  const c = [FLIP.has(name) ? "flip" : "", cls].filter(Boolean).join(" ");
  return `<svg class="${c ? `ico ${c}` : "ico"}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const GITHUB_SVG =
  '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>';
