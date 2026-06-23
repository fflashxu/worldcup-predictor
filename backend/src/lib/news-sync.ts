// News-based result sync — multi-source, auto-fallback
// Sources: sporttery.cn (match status) → openligadb recent (fresher data)

import { generateGroupMatches } from './tournament';
import { injectResults } from './datasource';
import { prisma } from './prisma';

export async function syncFromNews(): Promise<number> {
  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const doneIds = new Set(results.map(r => r.matchId));
  const allMatches = generateGroupMatches();

  // Try sporttery.cn for match status updates
  try {
    const res = await fetch('https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had&channel=c');
    const data: any = await res.json();
    const toInject: { matchId: string; homeScore: number; awayScore: number }[] = [];

    for (const day of data?.value?.matchInfoList || []) {
      for (const m of day?.subMatchList || []) {
        // Sporttery has score in sectionsNo999 for finished matches
        const score = m.sectionsNo999 || m.finalScore || '';
        const status = m.matchStatus || '';
        if (status !== 'Finish' && status !== 'Settled') continue;
        if (!score || !score.includes(':')) continue;
        const [h, a] = score.split(':').map(Number);
        if (isNaN(h) || isNaN(a)) continue;

        const homeCN = m.homeTeamAllName;
        const awayCN = m.awayTeamAllName;

        // Find matching match in our schedule
        const match = allMatches.find(x => x.home === homeCN && x.away === awayCN);
        if (match && !doneIds.has(match.id)) {
          toInject.push({ matchId: match.id, homeScore: h, awayScore: a });
        }
      }
    }
    if (toInject.length > 0) return injectResults(toInject);
  } catch (e) { /* sporttery unavailable, try next source */ }

  return 0;
}
