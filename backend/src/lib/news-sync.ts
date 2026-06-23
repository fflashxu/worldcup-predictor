// News-based result sync — faster than sports APIs (minutes vs hours)
// Searches Chinese news sources for real-time match scores

import { generateGroupMatches, TEAMS, GROUPS } from './tournament';
import { injectResults } from './datasource';
import { prisma } from './prisma';

// Search for a match result via pattern matching in search snippets
async function searchResult(
  home: string, away: string, matchId: string
): Promise<{ homeScore: number; awayScore: number } | null> {
  // Skip if already have result
  const existing = await prisma.prediction.findUnique({
    where: { matchId_predictedBy_variant: { matchId, predictedBy: 'result', variant: 1 } },
  });
  if (existing) return null;

  const query = `2026世界杯 ${home} ${away} 比分`;
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    );
    const html = await res.text();

    // Match patterns like "3-1", "2:0" near team names
    const scorePatterns = [
      new RegExp(`${home}[^0-9]*?(\\d+)[^0-9]*?[：:\\-]?[^0-9]*?(\\d+)[^0-9]*?${away}`, 'i'),
      new RegExp(`${away}[^0-9]*?(\\d+)[^0-9]*?[：:\\-]?[^0-9]*?(\\d+)[^0-9]*?${home}`, 'i'),
      new RegExp(`(\\d+)\\s*[：:\\-]\\s*(\\d+)`),
    ];

    for (const pattern of scorePatterns) {
      const match = html.match(pattern);
      if (match) {
        const s1 = parseInt(match[1]), s2 = parseInt(match[2]);
        if (s1 >= 0 && s2 >= 0 && (s1 > 0 || s2 > 0)) {
          // Check if home scored first number
          if (html.includes(home)) {
            const homeIdx = html.indexOf(home);
            const scoreIdx = html.indexOf(match[0]);
            if (scoreIdx > homeIdx) return { homeScore: s1, awayScore: s2 };
          }
          // Default: first number = home
          return { homeScore: s1, awayScore: s2 };
        }
      }
    }
  } catch (e) { /* search failed, skip */ }
  return null;
}

export async function syncFromNews(): Promise<number> {
  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const doneIds = new Set(results.map(r => r.matchId));
  const allMatches = generateGroupMatches();

  // Only search for recent/upcoming matches (last 1 day + next 2 days)
  const today = new Date();
  const toInject: { matchId: string; homeScore: number; awayScore: number }[] = [];

  for (const m of allMatches) {
    if (doneIds.has(m.id)) continue;
    if (!m.date) continue;
    const matchDate = new Date(m.date);
    const diffDays = (today.getTime() - matchDate.getTime()) / 86400000;
    // Only search matches that should have finished (played yesterday or earlier)
    if (diffDays < 0.5) continue; // Not yet played (less than 12h old)

    const result = await searchResult(m.home!, m.away!, m.id);
    if (result) {
      toInject.push({ matchId: m.id, ...result });
      console.log(`[news] Found: ${m.home} ${result.homeScore}-${result.awayScore} ${m.away}`);
    }
  }

  return injectResults(toInject);
}
