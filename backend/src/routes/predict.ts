import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { generateGroupMatches, R32_BRACKET, GROUPS, TEAMS, Match } from '../lib/tournament';
import { predictMatch, predictTournamentChampion } from '../lib/predict';

export const predictRouter = Router();

// GET /api/tournament — full tournament structure
predictRouter.get('/tournament', (_req: Request, res: Response) => {
  const groupMatches = generateGroupMatches();
  res.json({
    groups: Object.fromEntries(GROUPS.map(g => [g, TEAMS[g]])),
    groupMatches,
    r32Bracket: R32_BRACKET,
    totalMatches: groupMatches.length + R32_BRACKET.length + 8 + 4 + 2 + 2, // 72+16+8+4+2+2=104
  });
});

// GET /api/predictions — all saved predictions
predictRouter.get('/predictions', async (_req: Request, res: Response) => {
  const preds = await prisma.prediction.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(preds);
});

// POST /api/predict — submit prediction (user or trigger AI)
predictRouter.post('/predict', async (req: Request, res: Response) => {
  const { matchId, homeScore, awayScore, predictedBy } = req.body;
  if (!matchId || homeScore === undefined || awayScore === undefined) {
    return res.status(400).json({ error: 'matchId, homeScore, awayScore required' });
  }

  const pred = await prisma.prediction.upsert({
    where: { matchId_predictedBy: { matchId, predictedBy: predictedBy || 'user' } },
    update: { homeScore, awayScore },
    create: { matchId, homeScore, awayScore, predictedBy: predictedBy || 'user', tournamentRound: 'GROUP' },
  });

  res.json(pred);
});

// POST /api/predict/ai — dual-model: MC Bayesian + DeepSeek (key matches)
predictRouter.post('/predict/ai', async (_req: Request, res: Response) => {
  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const doneIds = new Set(results.map(r => r.matchId));
  const allMatches = generateGroupMatches();
  const remaining = allMatches.filter(m => !doneIds.has(m.id));

  const { computeStandings } = await import('../lib/standings');
  const currentStandings = await computeStandings();

  // Phase 1: MC Bayesian for ALL remaining matches
  let mcCount = 0;
  for (const m of remaining) {
    const hλ = estStr(m.home!, currentStandings);
    const aλ = estStr(m.away!, currentStandings);
    await prisma.prediction.upsert({
      where: { matchId_predictedBy: { matchId: m.id, predictedBy: 'mc' } },
      update: { homeScore: Math.round(hλ), awayScore: Math.round(aλ) },
      create: { matchId: m.id, homeScore: Math.round(hλ), awayScore: Math.round(aλ), predictedBy: 'mc', tournamentRound: 'GROUP' },
    });
    mcCount++;
  }

  // Phase 2: DeepSeek for key matches (next 5, or high-importance)
  const { predictMatch } = await import('../lib/predict');
  const existingResults: any[] = allMatches.map(m => {
    const r = results.find(p => p.matchId === m.id);
    return r ? { ...m, homeScore: r.homeScore, awayScore: r.awayScore } : m;
  });
  let dsCount = 0;
  const keyMatches = remaining.slice(0, 5); // next 5 upcoming matches
  for (const m of keyMatches) {
    try {
      const pred = await predictMatch(m, existingResults);
      await prisma.prediction.upsert({
        where: { matchId_predictedBy: { matchId: m.id, predictedBy: 'ds' } },
        update: { homeScore: pred.homeScore, awayScore: pred.awayScore },
        create: { matchId: m.id, homeScore: pred.homeScore, awayScore: pred.awayScore, predictedBy: 'ds', tournamentRound: 'GROUP' },
      });
      dsCount++;
    } catch (e) { console.error(`DS predict failed for ${m.id}:`, e); }
  }

  res.json({ mc: mcCount, ds: dsCount });
});

// GET /api/accuracy — compare predictions vs real results
predictRouter.get('/accuracy', async (_req: Request, res: Response) => {
  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const preds = await prisma.prediction.findMany({
    where: { predictedBy: { in: ['mc', 'ds', 'ai', 'user'] } },
  });

  const stats: Record<string, { total: number; exact: number; direction: number }> = {};
  for (const r of results) {
    for (const p of preds.filter(x => x.matchId === r.matchId)) {
      if (!stats[p.predictedBy]) stats[p.predictedBy] = { total: 0, exact: 0, direction: 0 };
      stats[p.predictedBy].total++;
      if (p.homeScore === r.homeScore && p.awayScore === r.awayScore) stats[p.predictedBy].exact++;
      const pDir = Math.sign(p.homeScore - p.awayScore);
      const rDir = Math.sign(r.homeScore - r.awayScore);
      if (pDir === rDir) stats[p.predictedBy].direction++;
    }
  }

  res.json(stats);
});

function estStr(team: string, st: Record<string, any[]>): number {
  const gs = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  for (const g of gs) {
    const t = (st[g] || []).find((x: any) => x.name === team);
    if (t && t.played > 0) return (t.gf + 3.9) / (t.played + 3);
  }
  return 1.3;
}

// GET /api/schedule — full match schedule with real dates from openligadb
predictRouter.get('/schedule', async (_req: Request, res: Response) => {
  const { loadDateMap } = await import('../lib/tournament');
  await loadDateMap();
  const matches = generateGroupMatches();
  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const resultMap = new Map(results.map(r => [r.matchId, r]));

  const schedule = matches.map(m => {
    const r = resultMap.get(m.id);
    return { ...m, homeScore: r?.homeScore, awayScore: r?.awayScore, completed: !!r };
  });

  const byDate: Record<string, typeof schedule> = {};
  for (const m of schedule) {
    const date = m.date || 'TBD';
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(m);
  }

  res.json({ matches: schedule, byDate, totalCompleted: results.length });
});

// GET /api/standings — current group standings
predictRouter.get('/standings', async (_req: Request, res: Response) => {
  const { computeStandings } = await import('../lib/standings');
  res.json(await computeStandings());
});

// GET /api/bracket — projected knockout bracket
predictRouter.get('/bracket', async (_req: Request, res: Response) => {
  const { resolveBracket, computeKnockoutSlots } = await import('../lib/standings');
  const bracket = await resolveBracket();
  const slots = await computeKnockoutSlots();
  res.json({
    bracket,
    groupWinners: slots.groupWinners.map(t => ({ name: t.name, group: t.group, pts: t.pts, gd: t.gd })),
    groupRunnersUp: slots.groupRunnersUp.map(t => ({ name: t.name, group: t.group, pts: t.pts, gd: t.gd })),
    qualifyingThirds: slots.qualifyingThirds.map(t => ({ name: t.name, group: t.group, pts: t.pts, gd: t.gd })),
  });
});

// GET /api/champion — Monte Carlo full simulation results
predictRouter.get('/champion', async (_req: Request, res: Response) => {
  const { runMonteCarlo } = await import('../lib/montecarlo');
  const result = await runMonteCarlo();
  res.json({ ...result, generatedAt: new Date().toISOString() });
});

// POST /api/sync — manually trigger data sync
predictRouter.post('/sync', async (_req: Request, res: Response) => {
  const { syncFromOpenLiga } = await import('../lib/sync');
  const result = await syncFromOpenLiga();
  res.json(result);
});

// GET /api/data-status — show data completeness
predictRouter.get('/data-status', async (_req: Request, res: Response) => {
  const { getDataStatus } = await import('../lib/datasource');
  res.json(await getDataStatus());
});

// POST /api/results/batch — inject multiple results
predictRouter.post('/results/batch', async (req: Request, res: Response) => {
  const { results } = req.body;
  if (!Array.isArray(results)) return res.status(400).json({ error: 'results array required' });
  const { injectResults } = await import('../lib/datasource');
  const count = await injectResults(results);
  res.json({ injected: count });
});

// POST /api/results — inject single result
predictRouter.post('/results', async (req: Request, res: Response) => {
  const { matchId, homeScore, awayScore } = req.body;
  if (!matchId) return res.status(400).json({ error: 'matchId required' });

  // Save as verified result (predictedBy='result')
  const result = await prisma.prediction.upsert({
    where: { matchId_predictedBy: { matchId, predictedBy: 'result' } },
    update: { homeScore, awayScore },
    create: { matchId, homeScore, awayScore, predictedBy: 'result', tournamentRound: 'GROUP' },
  });
  res.json(result);
});
