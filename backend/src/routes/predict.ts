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

// POST /api/predict — submit one prediction variant
predictRouter.post('/predict', async (req: Request, res: Response) => {
  const { matchId, homeScore, awayScore, predictedBy, variant } = req.body;
  if (!matchId || homeScore === undefined || awayScore === undefined) {
    return res.status(400).json({ error: 'matchId, homeScore, awayScore required' });
  }
  const pred = await prisma.prediction.upsert({
    where: { matchId_predictedBy_variant: { matchId, predictedBy: predictedBy || 'user', variant: variant || 1 } },
    update: { homeScore, awayScore },
    create: { matchId, homeScore, awayScore, predictedBy: predictedBy || 'user', variant: variant || 1, tournamentRound: 'GROUP' },
  });
  res.json(pred);
});

// POST /api/predict/mc/:matchId — Monte Carlo for one match
predictRouter.post('/predict/mc/:matchId', async (req: Request, res: Response) => {
  const { matchId } = req.params;
  const allMatches = generateGroupMatches();
  const match = allMatches.find(m => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const { computeStandings } = await import('../lib/standings');
  const st = await computeStandings();
  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const doneIds = new Set(results.map(r => r.matchId));
  if (doneIds.has(matchId)) return res.json({ skipped: true, reason: 'already played' });

  // Predict 3 MC variants (different random seeds from Poisson)
  const preds = [];
  for (let v = 1; v <= 3; v++) {
    const hλ = estStr(match.home!, st);
    const aλ = estStr(match.away!, st);
    // Add noise for variants
    const noise = () => Math.round(Math.random() * 2 - 1); // -1, 0, or 1
    const h = Math.max(0, Math.round(hλ) + noise());
    const a = Math.max(0, Math.round(aλ) + noise());
    const p = await prisma.prediction.upsert({
      where: { matchId_predictedBy_variant: { matchId, predictedBy: 'mc', variant: v } },
      update: { homeScore: h, awayScore: a },
      create: { matchId, homeScore: h, awayScore: a, predictedBy: 'mc', variant: v, tournamentRound: 'GROUP' },
    });
    preds.push({ variant: v, homeScore: p.homeScore, awayScore: p.awayScore });
  }
  res.json({ matchId, predictions: preds });
});

// POST /api/predict/ds/:matchId — DeepSeek for one match
predictRouter.post('/predict/ds/:matchId', async (req: Request, res: Response) => {
  const { matchId } = req.params;
  const allMatches = generateGroupMatches();
  const match = allMatches.find(m => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const doneIds = new Set(results.map(r => r.matchId));
  if (doneIds.has(matchId)) return res.json({ skipped: true, reason: 'already played' });

  const { predictMatch } = await import('../lib/predict');
  const existingResults: any[] = allMatches.map(m => {
    const r = results.find(p => p.matchId === m.id);
    return r ? { ...m, homeScore: r.homeScore, awayScore: r.awayScore } : m;
  });

  const preds = [];
  for (let v = 1; v <= 3; v++) {
    try {
      const pred = await predictMatch(match, existingResults);
      const p = await prisma.prediction.upsert({
        where: { matchId_predictedBy_variant: { matchId, predictedBy: 'ds', variant: v } },
        update: { homeScore: pred.homeScore, awayScore: pred.awayScore },
        create: { matchId, homeScore: pred.homeScore, awayScore: pred.awayScore, predictedBy: 'ds', variant: v, tournamentRound: 'GROUP' },
      });
      preds.push({ variant: v, homeScore: p.homeScore, awayScore: p.awayScore });
    } catch (e) { console.error(`DS v${v} failed:`, e); }
  }
  res.json({ matchId, predictions: preds });
});

// GET /api/accuracy — compare predictions vs real results (by model, variant 1 only)
predictRouter.get('/accuracy', async (_req: Request, res: Response) => {
  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const preds = await prisma.prediction.findMany({ where: { predictedBy: { in: ['mc', 'ds', 'user'] }, variant: 1 } });
  const stats: Record<string, any> = {};
  for (const r of results) {
    for (const p of preds.filter(x => x.matchId === r.matchId)) {
      if (!stats[p.predictedBy]) stats[p.predictedBy] = { total: 0, exact: 0, direction: 0 };
      stats[p.predictedBy].total++;
      if (p.homeScore === r.homeScore && p.awayScore === r.awayScore) stats[p.predictedBy].exact++;
      if (Math.sign(p.homeScore - p.awayScore) === Math.sign(r.homeScore - r.awayScore)) stats[p.predictedBy].direction++;
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
