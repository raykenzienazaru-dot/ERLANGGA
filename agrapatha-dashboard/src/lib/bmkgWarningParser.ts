/**
 * Flora AI Dashboard — BMKG Early Weather Warning (Nowcast) Parser
 * Defensively parses RSS 2.0 XML and CAP v1.2 detail elements.
 * Strictly respects unknown expiration timestamps and geographic uncertainty.
 */

import type {
  BmkgNormalizedAlert,
  BmkgRegionRecord,
  BmkgSpatialApplicability,
} from '../types/bmkg.ts';

export interface ParseWarningResult {
  success: boolean;
  alerts: BmkgNormalizedAlert[];
  error?: string;
}

/**
 * Extracts all matching tag text contents safely from an XML Element,
 * matching with or without XML namespace prefixes (e.g. <cap:event> and <event>).
 */
function getAllTagTexts(el: Element, tagName: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  const add = (txt: string | null | undefined) => {
    if (txt) {
      const trimmed = txt.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        results.push(trimmed);
      }
    }
  };

  // 1. Try getElementsByTagNameNS with wildcard namespace
  if (typeof el.getElementsByTagNameNS === 'function') {
    try {
      const nodes = el.getElementsByTagNameNS('*', tagName);
      for (let i = 0; i < nodes.length; i++) {
        add(nodes[i].textContent);
      }
    } catch {
      // Ignore if NS lookup unsupported
    }
  }

  // 2. Direct getElementsByTagName (standard and cap: prefixed)
  if (results.length === 0) {
    const nodes = el.getElementsByTagName(tagName);
    for (let i = 0; i < nodes.length; i++) {
      add(nodes[i].textContent);
    }
    const capNodes = el.getElementsByTagName(`cap:${tagName}`);
    for (let i = 0; i < capNodes.length; i++) {
      add(capNodes[i].textContent);
    }
  }

  // 3. Fallback scan by localName across all descendant elements
  if (results.length === 0) {
    const all = el.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const nodeEl = all[i];
      const local = nodeEl.localName || nodeEl.nodeName.split(':').pop();
      if (local && local.toLowerCase() === tagName.toLowerCase()) {
        add(nodeEl.textContent);
      }
    }
  }

  return results;
}

/**
 * Extracts tag text safely from an XML Element (namespace-agnostic).
 */
function getTagText(el: Element, tagName: string): string {
  const all = getAllTagTexts(el, tagName);
  return all.length > 0 ? all[0] : '';
}

interface RawExtractedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  headline: string;
  event: string;
  effective: string;
  expires: string;
  senderName: string;
  polygons: string[];
}

/**
 * Fallback lightweight XML item extractor for non-DOM environments (e.g. Node tests),
 * with robust namespace-agnostic tag extraction.
 */
function parseXmlItemsRegex(xmlString: string): RawExtractedItem[] {
  const items: RawExtractedItem[] = [];
  // Match either <item>...</item> (RSS) or <info>...</info> (CAP)
  const itemRegex = /<(?:[a-zA-Z0-9_-]+:)?(?:item|info)(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?(?:item|info)>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xmlString)) !== null) {
    const itemBlock = match[1];

    const extractFirst = (tag: string): string => {
      const tagRegex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, 'i');
      const tagMatch = tagRegex.exec(itemBlock);
      if (tagMatch) {
        return tagMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
      }
      return '';
    };

    const extractAll = (tag: string): string[] => {
      const values: string[] = [];
      const tagRegex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = tagRegex.exec(itemBlock)) !== null) {
        const clean = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
        if (clean && !values.includes(clean)) {
          values.push(clean);
        }
      }
      return values;
    };

    const title = extractFirst('title');
    const link = extractFirst('link');
    const description = extractFirst('description');
    const pubDate = extractFirst('pubDate');
    const guid = extractFirst('guid') || extractFirst('identifier');
    const headline = extractFirst('headline');
    const event = extractFirst('event');
    const effective = extractFirst('effective');
    const expires = extractFirst('expires');
    const senderName = extractFirst('senderName') || extractFirst('sender');
    const polygons = extractAll('polygon');

    if (title || headline || description || event) {
      items.push({
        title,
        link,
        description,
        pubDate,
        guid,
        headline,
        event,
        effective,
        expires,
        senderName,
        polygons,
      });
    }
  }

  return items;
}

/**
 * Parses raw RSS/CAP XML content and extracts active weather warnings.
 */
export function parseBmkgWarnings(
  xmlContent: string,
  selectedRegion?: BmkgRegionRecord | null
): ParseWarningResult {
  if (!xmlContent || typeof xmlContent !== 'string') {
    return { success: false, alerts: [], error: 'Empty or non-string XML input' };
  }

  const alerts: BmkgNormalizedAlert[] = [];
  const seenIds = new Set<string>();

  // Attempt standard DOMParser if available in browser
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlContent, 'application/xml');

      // Check for XML parse errors
      const parseError = doc.getElementsByTagName('parsererror')[0];
      if (parseError) {
        return {
          success: false,
          alerts: [],
          error: `XML syntax error: ${parseError.textContent?.slice(0, 120)}`,
        };
      }

      // Collect item or info elements
      let itemNodes: ArrayLike<Element> = doc.getElementsByTagName('item');
      if (itemNodes.length === 0) {
        const capItems = doc.getElementsByTagNameNS
          ? doc.getElementsByTagNameNS('*', 'item')
          : doc.getElementsByTagName('cap:item');
        if (capItems.length > 0) {
          itemNodes = capItems;
        } else {
          itemNodes = doc.getElementsByTagName('info');
        }
      }

      for (let i = 0; i < itemNodes.length; i++) {
        const item = itemNodes[i];
        const title = getTagText(item, 'title');
        const link = getTagText(item, 'link');
        const description = getTagText(item, 'description');
        const pubDate = getTagText(item, 'pubDate');
        const guid = getTagText(item, 'guid') || getTagText(item, 'identifier');
        const headline = getTagText(item, 'headline') || title;
        const event = getTagText(item, 'event') || 'Peringatan Dini Cuaca';
        const effective = getTagText(item, 'effective') || pubDate;
        const expires = getTagText(item, 'expires');
        const sender = getTagText(item, 'senderName') || getTagText(item, 'sender') || 'BMKG';
        const polygonStrings = getAllTagTexts(item, 'polygon');

        const normalized = createNormalizedAlert({
          title,
          link,
          description,
          guid,
          headline,
          event,
          effective,
          expires,
          sender,
          polygonStrings,
          selectedRegion,
          index: i,
        });

        if (normalized && !seenIds.has(normalized.id)) {
          seenIds.add(normalized.id);
          alerts.push(normalized);
        }
      }
    } catch {
      // Fallback to regex parser
      return parseWithRegexFallback(xmlContent, selectedRegion);
    }
  } else {
    // Non-browser / Node.js test environment
    return parseWithRegexFallback(xmlContent, selectedRegion);
  }

  return { success: true, alerts };
}

function parseWithRegexFallback(
  xmlContent: string,
  selectedRegion?: BmkgRegionRecord | null
): ParseWarningResult {
  const items = parseXmlItemsRegex(xmlContent);
  const alerts: BmkgNormalizedAlert[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const normalized = createNormalizedAlert({
      title: raw.title || '',
      link: raw.link || '',
      description: raw.description || '',
      guid: raw.guid || '',
      headline: raw.headline || raw.title || '',
      event: raw.event || 'Peringatan Dini Cuaca',
      effective: raw.effective || raw.pubDate || '',
      expires: raw.expires || '',
      sender: raw.senderName || 'BMKG',
      polygonStrings: raw.polygons,
      selectedRegion,
      index: i,
    });

    if (normalized && !seenIds.has(normalized.id)) {
      seenIds.add(normalized.id);
      alerts.push(normalized);
    }
  }

  return { success: true, alerts };
}

interface AlertRawParams {
  title: string;
  link: string;
  description: string;
  guid: string;
  headline: string;
  event: string;
  effective: string;
  expires: string;
  sender: string;
  polygonStrings: string[];
  selectedRegion?: BmkgRegionRecord | null;
  index: number;
}

function createNormalizedAlert(params: AlertRawParams): BmkgNormalizedAlert | null {
  const {
    link,
    description,
    guid,
    headline,
    event,
    effective,
    expires,
    sender,
    polygonStrings,
    selectedRegion,
    index,
  } = params;

  if (!headline && !description && !event) return null;

  // Deduplication identifier
  const id = guid || link || `bmkg-alert-${index}-${hashString(`${event}-${effective}-${headline}`)}`;

  // Timestamp and Expiration Validation:
  // RULE: NEVER assign arbitrary 6-hour expiration if source provides none.
  let validityStatus: 'VALID' | 'EXPIRED' | 'UNKNOWN_EXPIRY' = 'UNKNOWN_EXPIRY';
  let expiresIso: string | null = null;
  let effectiveIso: string | null = null;

  if (effective) {
    const parsedEffective = Date.parse(effective);
    if (!isNaN(parsedEffective)) {
      effectiveIso = new Date(parsedEffective).toISOString();
    } else {
      effectiveIso = effective;
    }
  }

  if (expires) {
    const parsedExpires = Date.parse(expires);
    if (!isNaN(parsedExpires)) {
      expiresIso = new Date(parsedExpires).toISOString();
      if (parsedExpires < Date.now()) {
        validityStatus = 'EXPIRED';
      } else {
        validityStatus = 'VALID';
      }
    } else {
      // Invalid date string
      validityStatus = 'UNKNOWN_EXPIRY';
      expiresIso = null;
    }
  } else {
    // Missing expiry is explicitly marked UNKNOWN_EXPIRY (not fabricated)
    validityStatus = 'UNKNOWN_EXPIRY';
    expiresIso = null;
  }

  // Geographic Applicability & Multiple-Polygon Support:
  // RULE: Do not claim village applicability based on text similarity or place name alone.
  let applicability: BmkgSpatialApplicability = 'REGIONAL_UNVERIFIED';
  const allPolygons: [number, number][][] = [];

  for (const polyStr of polygonStrings) {
    const coords = parsePolygonCoordinates(polyStr);
    if (coords && coords.length >= 3) {
      allPolygons.push(coords);
    }
  }

  if (allPolygons.length > 0 && selectedRegion?.coordinates) {
    const isInsideAny = allPolygons.some((poly) =>
      isPointInPolygon(
        [selectedRegion.coordinates.lat, selectedRegion.coordinates.lon],
        poly
      )
    );
    if (isInsideAny) {
      applicability = 'GEOGRAPHIC_MATCH';
    } else {
      applicability = 'REGIONAL_UNVERIFIED';
    }
  }

  // Extract source geographic scope from headline or description
  const geographicScope = extractGeographicScope(headline, description);

  return {
    id,
    headline: headline || 'Peringatan Dini Cuaca',
    event: event || 'Peringatan Dini Cuaca',
    description: description || 'Detail peringatan cuaca BMKG belum tersedia.',
    effectiveTime: effectiveIso,
    expiresTime: expiresIso,
    validityStatus,
    sender: sender || 'BMKG',
    sourceUrl: link || 'https://www.bmkg.go.id/alerts/nowcast/id',
    applicability,
    geographicScope,
    polygonCoordinates: allPolygons[0],
    allPolygons: allPolygons.length > 0 ? allPolygons : undefined,
  };
}

/**
 * Parses space/comma-separated coordinate pairs into [lat, lon] tuples.
 */
function parsePolygonCoordinates(polyStr: string): [number, number][] | undefined {
  try {
    const clean = polyStr.trim();
    if (!clean) return undefined;
    const tokens = clean.split(/\s+/);
    const coords: [number, number][] = [];

    for (const token of tokens) {
      const parts = token.split(',');
      if (parts.length === 2) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          coords.push([lat, lon]);
        }
      }
    }

    return coords.length >= 3 ? coords : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Standard Ray-Casting algorithm for point-in-polygon check.
 */
function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

function extractGeographicScope(headline: string, description: string): string {
  const match = /(?:wilayah|provinsi|kabupaten|kota)\s+([A-Za-z\s]+?)(?:\s+dan|\s+sekitarnya|\.|$)/i.exec(headline);
  if (match && match[1]) {
    return match[1].trim();
  }
  const descMatch = /Wilayah terdampak:\s*([^.]+)/i.exec(description);
  if (descMatch && descMatch[1]) {
    return descMatch[1].trim().slice(0, 80);
  }
  return 'Wilayah Regional';
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
