import { getOptimalDatabase } from '../server/db.ts';

const STATIC_CLUB_NAME_MAP: Record<string, string> = {
  // Official FPL short_name -> FPL team.name (matches Tab Matches)
  ARS: 'Arsenal',
  AVL: 'Aston Villa',
  BOU: 'Bournemouth',
  BRE: 'Brentford',
  BHA: 'Brighton',
  BUR: 'Burnley',
  CHE: 'Chelsea',
  COV: 'Coventry City',
  CRY: 'Crystal Palace',
  EVE: 'Everton',
  FUL: 'Fulham',
  HUL: 'Hull City',
  IPS: 'Ipswich Town',
  LEE: 'Leeds',
  LEI: 'Leicester',
  LIV: 'Liverpool',
  LUT: 'Luton',
  MCI: 'Man City',
  MUN: 'Man Utd',
  NEW: 'Newcastle',
  NFO: "Nott'm Forest",
  SHU: 'Sheffield Utd',
  SOU: 'Southampton',
  SUN: 'Sunderland',
  TOT: 'Spurs',
  WHU: 'West Ham',
  WOL: 'Wolves',

  // External / Pulse long names -> exact FPL Tab Matches team.name
  'arsenal': 'Arsenal',
  'aston villa': 'Aston Villa',
  'afc bournemouth': 'Bournemouth',
  'bournemouth': 'Bournemouth',
  'brentford': 'Brentford',
  'brighton and hove albion': 'Brighton',
  'brighton & hove albion': 'Brighton',
  'brighton': 'Brighton',
  'burnley': 'Burnley',
  'chelsea': 'Chelsea',
  'coventry': 'Coventry City',
  'coventry city': 'Coventry City',
  'crystal palace': 'Crystal Palace',
  'everton': 'Everton',
  'fulham': 'Fulham',
  'hull': 'Hull City',
  'hull city': 'Hull City',
  'ipswich': 'Ipswich Town',
  'ipswich town': 'Ipswich Town',
  'leeds': 'Leeds',
  'leeds united': 'Leeds',
  'leicester': 'Leicester',
  'leicester city': 'Leicester',
  'liverpool': 'Liverpool',
  'luton': 'Luton',
  'luton town': 'Luton',
  'manchester city': 'Man City',
  'man city': 'Man City',
  'manchester united': 'Man Utd',
  'man utd': 'Man Utd',
  'newcastle': 'Newcastle',
  'newcastle united': 'Newcastle',
  'nottingham forest': "Nott'm Forest",
  "nott'm forest": "Nott'm Forest",
  'sheffield united': 'Sheffield Utd',
  'sheffield utd': 'Sheffield Utd',
  'southampton': 'Southampton',
  'sunderland': 'Sunderland',
  'tottenham': 'Spurs',
  'tottenham hotspur': 'Spurs',
  'spurs': 'Spurs',
  'west ham': 'West Ham',
  'west ham united': 'West Ham',
  'wolverhampton wanderers': 'Wolves',
  'wolves': 'Wolves',
};

let dynamicMapCache: Record<string, string> | null = null;
let dynamicMapTimestamp = 0;

export function getClubNameLookup(): Record<string, string> {
  const now = Date.now();
  if (dynamicMapCache && now - dynamicMapTimestamp < 30000) {
    return dynamicMapCache;
  }

  const merged: Record<string, string> = { ...STATIC_CLUB_NAME_MAP };
  try {
    const db = getOptimalDatabase();
    for (const p of Object.values(db.players || {})) {
      if (p?.teamShort && p?.teamName) {
        merged[String(p.teamShort).trim().toUpperCase()] = String(p.teamName).trim();
        merged[String(p.teamName).trim().toLowerCase()] = String(p.teamName).trim();
      }
    }
  } catch {}

  dynamicMapCache = merged;
  dynamicMapTimestamp = now;
  return merged;
}

/**
 * Resolves any club short code (e.g. 'CHE', 'MCI', 'NFO') or external full name
 * (e.g. 'Manchester City', 'Nottingham Forest') into the exact FPL Tab Matches team.name.
 */
export function resolveClubName(clubInput?: string | null, fallback = ''): string {
  const raw = String(clubInput || '').trim();
  if (!raw || raw.toUpperCase() === 'UNK' || raw.toUpperCase() === 'PL') {
    return fallback;
  }

  const map = getClubNameLookup();
  const upper = raw.toUpperCase();
  if (map[upper]) return map[upper];

  const lower = raw.toLowerCase();
  if (map[lower]) return map[lower];

  return raw;
}
