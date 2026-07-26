// Visual-verification manifest, derived from SPEC.md. This file is DATA:
// every capture target the pipeline knows about. capture.mjs walks it,
// diff.mjs enforces it, the Asset Gallery (unit D2) must implement its
// rendering contract.
//
// RENDERING CONTRACT (for units D1/D2/C2–C4 — normative for this pipeline):
//   - The new shell marks itself with `html[data-shell="next"]`. Route
//     captures are skipped (recorded as "missing") until that marker exists,
//     so the old client is never captured under new-UI ids.
//   - The Asset Gallery (#/assets, dev builds) renders every component state
//     below as a static instance tagged `data-vis="<Component>/<variant>/<state>"`
//     inside a container tagged `[data-vis-gallery]`. Interaction states
//     (hover/focus/active) are NOT rendered as fakes: the pipeline drives a
//     real hover/focus/mousedown on the `default` instance and screenshots it.
//   - States S/L/E/Er/X (selected/loading/empty/error/disabled) are rendered
//     as separate instances with the state slug in data-vis.
//
// SPEC citations: routes §2.1; component inventory + required states §4.4;
// themes §4.1 (both, dark default); captures run under motion `reduced`
// (§5.1) plus Playwright animation freezing so pixels are deterministic —
// motion correctness is covered by deterministic CSS checks and F2 step 10,
// not by screenshots.

export const THEMES = ['dark', 'light'];

// §2.1 production routes (hash paths). `#/assets` is dev-only; the gallery is
// captured because capture runs against the dev client — see capture.mjs.
export const ROUTES = [
  { id: 'home', hash: '#/' },
  { id: 'convert', hash: '#/convert' },
  { id: 'pdf', hash: '#/pdf' },
  { id: 'media', hash: '#/media' },
  { id: 'text', hash: '#/text' },
  { id: 'security', hash: '#/security' },
  { id: 'utilities', hash: '#/utilities' },
  { id: 'activity', hash: '#/activity' },
  { id: 'settings', hash: '#/settings' },
  { id: 'profile', hash: '#/profile' },
];

// Hub routes where a mode-tab click is driven to measure interaction CLS.
export const TAB_INTERACTION_ROUTES = ['pdf', 'media', 'text', 'security', 'utilities'];

// §4.4 state legend → slug + how the pipeline produces it.
// kind 'instance' = gallery renders it; 'interaction' = driven on the default instance.
const STATE_MAP = {
  D: { slug: 'default', kind: 'instance' },
  H: { slug: 'hover', kind: 'interaction', action: 'hover' },
  F: { slug: 'focus', kind: 'interaction', action: 'focus' },
  A: { slug: 'active', kind: 'interaction', action: 'mousedown' },
  S: { slug: 'selected', kind: 'instance' },
  L: { slug: 'loading', kind: 'instance' },
  E: { slug: 'empty', kind: 'instance' },
  Er: { slug: 'error', kind: 'instance' },
  X: { slug: 'disabled', kind: 'instance' },
};

// §4.4 component inventory, verbatim variants and required states.
// variants: [''] means the component has a single (unnamed) variant.
const INVENTORY = [
  { component: 'button', variants: ['primary', 'secondary', 'ghost', 'danger', 'icon'], states: ['D', 'H', 'F', 'A', 'L', 'X'] },
  { component: 'tabs', variants: ['underline', 'segmented'], states: ['D', 'H', 'F', 'S', 'X'] },
  { component: 'field', variants: ['text', 'select', 'textarea', 'color', 'range', 'checkbox'], states: ['D', 'F', 'Er', 'X'] },
  { component: 'toggle', variants: [''], states: ['D', 'F', 'S', 'X'] },
  { component: 'dropzone', variants: ['files', 'paste'], states: ['D', 'H', 'F', 'A', 'X', 'E'] },
  { component: 'filerow', variants: [''], states: ['D', 'H', 'F', 'S', 'L', 'Er', 'X'] },
  { component: 'filelist', variants: [''], states: ['E'] },
  { component: 'progressbar', variants: ['determinate', 'indeterminate'], states: ['L'] },
  { component: 'statusbadge', variants: ['neutral', 'live', 'success', 'warning', 'danger'], states: ['D'] },
  { component: 'emptystate', variants: ['default', 'compact'], states: ['E'] },
  { component: 'errorstate', variants: [''], states: ['Er'] },
  { component: 'banner', variants: ['neutral', 'warning'], states: ['D'] },
  { component: 'modal', variants: ['dialog', 'palette'], states: ['D'] },
  { component: 'toast', variants: ['notice', 'success', 'danger'], states: ['D'] },
  { component: 'card', variants: ['panel', 'flat'], states: ['D'] },
  { component: 'skeleton', variants: ['block', 'row'], states: ['L'] },
  { component: 'commandpalette', variants: [''], states: ['D', 'E', 'S'] },
  { component: 'runbar', variants: [''], states: ['D', 'L', 'X'] },
  { component: 'resumestrip', variants: ['full', 'uploads-only'], states: ['D', 'E'] },
  { component: 'sidebar', variants: [''], states: ['D', 'H', 'F', 'S'] },
  { component: 'topbar', variants: [''], states: ['D'] },
];

export function stateEntries() {
  const entries = [];
  for (const { component, variants, states } of INVENTORY) {
    for (const variant of variants) {
      const v = variant || 'base';
      for (const code of states) {
        const st = STATE_MAP[code];
        entries.push({
          id: `state--${component}--${v}--${st.slug}`,
          component,
          variant: v,
          state: st.slug,
          kind: st.kind,
          action: st.action || null,
          // interaction states are driven on the default instance's node
          selector: `[data-vis="${component}/${v}/${st.kind === 'interaction' ? 'default' : st.slug}"]`,
        });
      }
    }
  }
  return entries;
}

export function routeEntries() {
  return ROUTES.map((r) => ({ id: `route--${r.id}`, ...r }));
}
