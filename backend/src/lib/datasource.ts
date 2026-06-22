// World Cup live data sources
// Priority: user-manual → WebSearch fallback → manual injection

import { prisma } from './prisma';
import { generateGroupMatches, Match } from './tournament';

// Check which matches are missing results
export async function getMissingResults(): Promise<Match[]> {
  const allMatches = generateGroupMatches();
  const results = await prisma.prediction.findMany({
    where: { predictedBy: 'result' },
  });
  const resultIds = new Set(results.map(r => r.matchId));
  return allMatches.filter(m => !resultIds.has(m.id));
}

// Batch inject results from external source
export async function injectResults(
  results: { matchId: string; homeScore: number; awayScore: number }[]
): Promise<number> {
  let count = 0;
  for (const r of results) {
    try {
      await prisma.prediction.upsert({
        where: { matchId_predictedBy: { matchId: r.matchId, predictedBy: 'result' } },
        update: { homeScore: r.homeScore, awayScore: r.awayScore },
        create: {
          matchId: r.matchId,
          homeScore: r.homeScore,
          awayScore: r.awayScore,
          predictedBy: 'result',
          tournamentRound: 'GROUP',
        },
      });
      count++;
    } catch (e) {
      // ignore duplicates
    }
  }
  return count;
}

// Get current correct results count
export async function getDataStatus() {
  const all = generateGroupMatches();
  const results = await prisma.prediction.findMany({
    where: { predictedBy: 'result' },
  });
  return {
    totalMatches: all.length,
    resultsRecorded: results.length,
    missing: all.length - results.length,
    completedGroups: [...new Set(results.map(r => {
      const m = all.find(x => x.id === r.matchId);
      return m?.group;
    }).filter(Boolean))],
  };
}
