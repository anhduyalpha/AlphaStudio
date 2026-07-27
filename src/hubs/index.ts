import convertHub from './convert';
import mediaHub from './media';
import pdfHub from './pdf';
import securityHub from './security';
import textDevHub from './textdev';
import utilitiesHub from './utilities';

export interface HubRouteMode {
  readonly id: string;
  readonly name: string;
}

export interface HubRouteConfig {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly modes: readonly HubRouteMode[];
}

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly href: string;
  readonly group: 'Workspace' | 'Studios' | 'Account';
  readonly modes?: readonly HubRouteMode[];
}

interface ViewRoute {
  readonly kind: 'view';
  readonly id: 'home' | 'activity' | 'settings' | 'profile' | 'assets';
  readonly name: string;
}

interface HubRoute {
  readonly kind: 'hub';
  readonly id: string;
  readonly name: string;
  readonly hub: HubRouteConfig;
}

export type RouteDefinition = ViewRoute | HubRoute;

export interface ResolvedRoute {
  readonly route: RouteDefinition;
  readonly href: string;
  readonly mode: HubRouteMode | null;
  readonly redirected: boolean;
  readonly requestedHash: string;
}

export const hubRegistry: readonly HubRouteConfig[] = Object.freeze([
  convertHub,
  pdfHub,
  mediaHub,
  textDevHub,
  securityHub,
  utilitiesHub,
]);

const homeRoute: ViewRoute = Object.freeze({ kind: 'view', id: 'home', name: 'Home' });

export const routeTable: Readonly<Record<string, RouteDefinition>> = Object.freeze({
  '#/': homeRoute,
  ...Object.fromEntries(hubRegistry.map((hub) => [
    `#/${hub.id}`,
    Object.freeze({ kind: 'hub', id: hub.id, name: hub.name, hub }),
  ])),
  '#/activity': Object.freeze({ kind: 'view', id: 'activity', name: 'Activity' }),
  '#/settings': Object.freeze({ kind: 'view', id: 'settings', name: 'Settings' }),
  '#/profile': Object.freeze({ kind: 'view', id: 'profile', name: 'Profile' }),
});

const assetRoute: ViewRoute = Object.freeze({
  kind: 'view',
  id: 'assets',
  name: 'Asset Gallery',
});

export const legacyRedirects: Readonly<Record<string, string>> = Object.freeze({
  '#/dashboard': '#/',
  '#/converter': '#/convert',
  '#/image': '#/media?mode=image',
  '#/audio': '#/media?mode=audio',
  '#/media': '#/media?mode=video',
  '#/archive': '#/security?mode=archive',
  '#/developer': '#/text?mode=dev',
  '#/qr': '#/utilities?mode=qr',
  '#/color': '#/utilities?mode=color',
  '#/text': '#/text?mode=text',
  '#/security': '#/security?mode=security',
});

const explicitDefaultModePaths = new Set(
  Object.entries(legacyRedirects)
    .filter(([from, to]) => to.startsWith(`${from}?mode=`))
    .map(([from]) => from),
);

export const navigationItems: readonly NavigationItem[] = Object.freeze([
  Object.freeze({
    id: 'home',
    label: 'Home',
    icon: 'dashboard',
    href: '#/',
    group: 'Workspace',
  }),
  ...hubRegistry.map((hub) => Object.freeze({
    id: hub.id,
    label: hub.name,
    icon: hub.icon,
    href: `#/${hub.id}`,
    group: 'Studios' as const,
    modes: hub.modes,
  })),
  Object.freeze({
    id: 'activity',
    label: 'Activity',
    icon: 'activity',
    href: '#/activity',
    group: 'Account',
  }),
  Object.freeze({
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    href: '#/settings',
    group: 'Account',
  }),
  Object.freeze({
    id: 'profile',
    label: 'Profile',
    icon: 'profile',
    href: '#/profile',
    group: 'Account',
  }),
]);

function normalizeHash(rawHash: string): string {
  const raw = rawHash.trim();
  if (!raw || raw === '#') return '#/';
  if (raw.startsWith('#/')) return raw;
  if (raw.startsWith('/')) return `#${raw}`;
  return `#/${raw.replace(/^#/, '')}`;
}

function routeTableFor(includeAssets: boolean): Readonly<Record<string, RouteDefinition>> {
  return includeAssets
    ? { ...routeTable, '#/assets': assetRoute }
    : routeTable;
}

export function resolveHashRoute(
  rawHash: string,
  { includeAssets = false }: { includeAssets?: boolean } = {},
): ResolvedRoute {
  const requestedHash = normalizeHash(rawHash);
  const redirectedHash = legacyRedirects[requestedHash] ?? requestedHash;
  const queryIndex = redirectedHash.indexOf('?');
  const path = queryIndex >= 0 ? redirectedHash.slice(0, queryIndex) : redirectedHash;
  const query = queryIndex >= 0 ? redirectedHash.slice(queryIndex + 1) : '';
  const route = routeTableFor(includeAssets)[path];

  if (!route) {
    return {
      route: homeRoute,
      href: '#/',
      mode: null,
      redirected: requestedHash !== '#/',
      requestedHash,
    };
  }

  if (route.kind === 'view') {
    return {
      route,
      href: path,
      mode: null,
      redirected: requestedHash !== path,
      requestedHash,
    };
  }

  const requestedMode = new URLSearchParams(query).get('mode');
  const selectedMode = route.hub.modes.find((mode) => mode.id === requestedMode)
    ?? route.hub.modes[0]
    ?? null;
  const shouldNameMode = Boolean(requestedMode) || explicitDefaultModePaths.has(path);
  const href = shouldNameMode && selectedMode
    ? `${path}?mode=${encodeURIComponent(selectedMode.id)}`
    : path;

  return {
    route,
    href,
    mode: selectedMode,
    redirected: requestedHash !== href,
    requestedHash,
  };
}
