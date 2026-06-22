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

// POST /api/predict/ai — trigger DeepSeek prediction
predictRouter.post('/predict/ai', async (req: Request, res: Response) => {
  const { matchId } = req.body;

  // Get existing results from DB
  const allPreds = await prisma.prediction.findMany();
  const groupMatches = generateGroupMatches();
  const existingResults: Match[] = groupMatches.map(m => {
    // Real results take priority over user predictions for AI context
    const result = allPreds.find(p => p.matchId === m.id && p.predictedBy === 'result');
    if (result) return { ...m, homeScore: result.homeScore, awayScore: result.awayScore };
    return m;
  });

  if (matchId) {
    // Predict single match
    const match = groupMatches.find(m => m.id === matchId);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const pred = await predictMatch(match, existingResults);
    // Save AI prediction
    await prisma.prediction.upsert({
      where: { matchId_predictedBy: { matchId, predictedBy: 'ai' } },
      update: { homeScore: pred.homeScore, awayScore: pred.awayScore },
      create: { matchId, homeScore: pred.homeScore, awayScore: pred.awayScore, predictedBy: 'ai', tournamentRound: 'GROUP' },
    });
    return res.json(pred);
  }

  // Predict all remaining
  const predictions = await predictTournamentChampion(existingResults);
  res.json({ predictions, count: predictions.length });
});

// GET /api/schedule — full match schedule with results
predictRouter.get('/schedule', async (_req: Request, res: Response) => {
  const matches = generateGroupMatches();
  const results = await prisma.prediction.findMany({
    where: { predictedBy: 'result' },
  });
  const resultMap = new Map(results.map(r => [r.matchId, r]));

  const schedule = matches.map(m => {
    const r = resultMap.get(m.id);
    return {
      ...m,
      homeScore: r?.homeScore,
      awayScore: r?.awayScore,
      completed: !!r,
    };
  });

  // Group by date
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
