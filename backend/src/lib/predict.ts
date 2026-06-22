import OpenAI from 'openai';
import { Match, TEAMS, GROUPS, generateGroupMatches, R32_BRACKET } from './tournament';

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseURL: 'https://api.deepseek.com/v1',
});

const MODEL = process.env.PREDICTION_MODEL || 'deepseek-chat';

export interface MatchPrediction {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TournamentPrediction {
  generatedAt: string;
  currentRound: string;
  matchesPredicted: number;
  championPrediction: { team: string; probability: number }[];
  groupWinners: Record<string, { first: string; second: string; third: string[] }>;
  knockoutPredictions: MatchPrediction[];
}

function buildContextPrompt(existingResults: Match[]): string {
  const completedMatches = existingResults.filter(m => m.homeScore !== undefined);
  const allGroupMatches = generateGroupMatches();

  // Inject only real data — no training data reliance
  const groupStandings = buildStandings(completedMatches);

  return `## 2026 FIFA World Cup — Current Tournament State
### Format: 48 teams, 12 groups (A-L) of 4. Top 2 + 8 best 3rd advance to Round of 32.

### Group Standings
${Object.entries(groupStandings).map(([g, teams]) => {
    return `Group ${g}: ${teams.map((t: any) =>
      `${t.name} Pts:${t.pts} GD:${t.gd} GF:${t.gf}`
    ).join(' | ')}`;
  }).join('\n')}

### Completed Matches
${completedMatches.slice(0, 30).map(m =>
  `${m.id}: ${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`
).join('\n') || 'No matches completed yet.'}

### Tournament Context
- Only ${completedMatches.length} of 72 group stage matches completed
- Group stage: June 11-27, 2026. Knockout: June 28 - July 19
- 4 points almost guarantees advancement; 3 points at mercy of goal difference
- Knockout bracket: R32→R16→QF→SF→Final (M73-M104 per FIFA)`;
}

function buildStandings(matches: Match[]) {
  const standings: Record<string, any[]> = {};
  for (const g of GROUPS) standings[g] = TEAMS[g].map(name => ({ name, pts: 0, gd: 0, gf: 0, ga: 0 }));

  for (const m of matches) {
    if (!m.group || m.homeScore === undefined) continue;
    const group = standings[m.group];
    if (!group) continue;
    const home = group.find(t => t.name === m.home);
    const away = group.find(t => t.name === m.away);
    if (!home || !away) continue;

    const hg = m.homeScore!, ag = m.awayScore!;
    home.gf += hg; home.ga += ag; home.gd += hg - ag;
    away.gf += ag; away.ga += hg; away.gd += ag - hg;
    if (hg > ag) home.pts += 3;
    else if (ag > hg) away.pts += 3;
    else { home.pts += 1; away.pts += 1; }
  }

  for (const g of GROUPS) standings[g].sort((a, b) => b.pts - a.pts || b.gd - a.gd);
  return standings;
}

export async function predictMatch(match: Match, existingResults: Match[], riskContext?: string): Promise<MatchPrediction> {
  const context = buildContextPrompt(existingResults);
  const riskPrompt = riskContext || '';

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'system',
      content: `You are a World Cup prediction expert. Analyze the provided real tournament data and predict match outcomes.
${riskPrompt}

Output ONLY valid JSON in this format:
{
  "homeScore": number,
  "awayScore": number,
  "homeWinProb": number (0-100),
  "drawProb": number (0-100),
  "awayWinProb": number (0-100),
  "reasoning": "brief analysis in Chinese referencing specific data",
  "confidence": "high" | "medium" | "low"
}

Base predictions on: current form (from results above), head-to-head history, group stage dynamics (who needs what result), tournament pressure, and squad quality.
ALL factual data in the context above comes from real-time API — do not use any training data.`,
    }, {
      role: 'user',
      content: `${context}\n\nPredict this match: ${match.home} vs ${match.away} (${match.round}${match.group ? ' Group ' + match.group : ''}, Match ${match.id})`,
    }],
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  const raw = JSON.parse(response.choices[0]?.message?.content || '{}');
  return {
    matchId: match.id,
    homeTeam: match.home || '',
    awayTeam: match.away || '',
    homeScore: raw.homeScore || 0,
    awayScore: raw.awayScore || 0,
    homeWinProb: raw.homeWinProb || 33,
    drawProb: raw.drawProb || 34,
    awayWinProb: raw.awayWinProb || 33,
    reasoning: raw.reasoning || '',
    confidence: raw.confidence || 'medium',
  };
}

export async function predictTournamentChampion(existingResults: Match[]): Promise<MatchPrediction[]> {
  const groupMatches = generateGroupMatches();
  const unplayed = groupMatches.filter(m =>
    !existingResults.find(r => r.id === m.id && r.homeScore !== undefined)
  );

  // Predict all remaining group matches
  const predictions = await Promise.all(
    unplayed.slice(0, 5).map(m => predictMatch(m, existingResults))
  );

  return predictions;
}
