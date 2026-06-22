import { GROUPS, TEAMS, Group, generateGroupMatches, R32_BRACKET } from './tournament';
import { computeStandings } from './standings';
import { prisma } from './prisma';

const SIMS = 10000;
const AVG_GOALS = 2.6;
const PRIOR_GOALS = AVG_GOALS / 2;
const PRIOR_W = 3;

// ── Poisson helpers ──
function poisson(lambda: number): number {
  const L = Math.exp(-lambda); let k = 0, p = 1;
  while (p > L) { k++; p *= Math.random(); }
  return k - 1;
}
function simScore(hλ: number, aλ: number): [number, number] { return [poisson(hλ), poisson(aλ)]; }
function simKO(hλ: number, aλ: number): 'home' | 'away' {
  let [h, a] = simScore(hλ, aλ);
  while (h === a) [h, a] = simScore(hλ * 0.8, aλ * 0.8);
  return h > a ? 'home' : 'away';
}

// Bayesian strength estimate
function strength(team: string, standings: Record<Group, any[]>): number {
  for (const g of GROUPS) {
    const s = standings[g]; if (!s) continue;
    const t = s.find((x: any) => x.name === team);
    if (!t || t.played === 0) continue;
    return (t.gf + PRIOR_GOALS * PRIOR_W) / (t.played + PRIOR_W);
  }
  return PRIOR_GOALS;
}

export interface GroupProbs {
  group: Group;
  teams: { name: string; first: number; second: number; third: number; fourth: number }[];
}
export interface OpponentProb {
  matchId: string;
  slot: string;
  opponents: { team: string; prob: number }[];
}
export interface SimResult {
  groupProbs: GroupProbs[];
  opponentProbs: OpponentProb[];
  champion: { team: string; probability: number }[];
  totalSims: number;
}

export async function runMonteCarlo(): Promise<SimResult> {
  const currentStandings = await computeStandings();
  const results = await prisma.prediction.findMany({ where: { predictedBy: 'result' } });
  const resultMap = new Map(results.map(r => [r.matchId, r]));
  const allMatches = generateGroupMatches();

  // Initialize counters
  const posCount: Record<string, Record<string, number[]>> = {}; // group → team → [1st,2nd,3rd,4th]
  const r32Opp: Record<string, Record<string, number>> = {}; // matchId → team → count
  const champCount: Record<string, number> = {};

  for (const g of GROUPS) {
    posCount[g] = {};
    for (const t of TEAMS[g]) posCount[g][t] = [0, 0, 0, 0];
  }
  for (const s of R32_BRACKET) r32Opp[s.matchId] = {};
  for (const g of GROUPS) for (const t of TEAMS[g]) champCount[t] = 0;

  for (let sim = 0; sim < SIMS; sim++) {
    // 1. Simulate remaining group matches
    const simSt: Record<string, Map<string, { pts: number; gd: number; gf: number }>> = {};
    for (const g of GROUPS) {
      simSt[g] = new Map();
      for (const t of TEAMS[g]) simSt[g].set(t, { pts: 0, gd: 0, gf: 0 });
    }

    for (const m of allMatches) {
      const real = resultMap.get(m.id);
      let hg: number, ag: number;
      if (real) { hg = real.homeScore; ag = real.awayScore; }
      else {
        const hλ = strength(m.home!, currentStandings);
        const aλ = strength(m.away!, currentStandings);
        [hg, ag] = simScore(hλ, aλ);
      }
      const g = m.group as Group;
      const hs = simSt[g].get(m.home!)!; const as = simSt[g].get(m.away!)!;
      hs.gf += hg; as.gf += ag; hs.gd += hg - ag; as.gd += ag - hg;
      if (hg > ag) hs.pts += 3; else if (ag > hg) as.pts += 3; else { hs.pts += 1; as.pts += 1; }
    }

    // 2. Rank groups → record positions
    const gw: Map<Group, string> = new Map();
    const gr: Map<Group, string> = new Map();
    const all3rds: { team: string; group: Group; pts: number; gd: number; gf: number }[] = [];

    for (const g of GROUPS) {
      const ranked = TEAMS[g].map(name => ({ name, ...simSt[g].get(name)! }))
        .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || Math.random() - 0.5);
      for (let i = 0; i < 4; i++) {
        posCount[g][ranked[i].name][i]++;
      }
      gw.set(g, ranked[0].name);
      gr.set(g, ranked[1].name);
      all3rds.push({ team: ranked[2].name, group: g, pts: ranked[2].pts, gd: ranked[2].gd, gf: ranked[2].gf });
    }

    all3rds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    const q3 = all3rds.slice(0, 8);
    const q3g = q3.map(t => t.group);

    // 3. Fill R32 bracket
    const wrPairs: [string, Group, Group][] = [['M75','F','C'],['M76','C','F'],['M84','H','J'],['M86','J','H']];
    const rrPairs: [string, Group, Group][] = [['M73','A','B'],['M78','E','I'],['M83','K','L'],['M88','D','G']];
    const w3Pairs: [string, Group][] = [
      ['M74','E'],['M77','I'],['M79','A'],['M80','L'],
      ['M81','D'],['M82','G'],['M85','B'],['M87','K'],
    ];

    for (const [mid, w, r] of wrPairs) {
      r32Opp[mid][gw.get(w)!] = (r32Opp[mid][gw.get(w)!] || 0) + 1;
      r32Opp[mid][gr.get(r)!] = (r32Opp[mid][gr.get(r)!] || 0) + 1;
    }
    for (const [mid, r1, r2] of rrPairs) {
      r32Opp[mid][gr.get(r1)!] = (r32Opp[mid][gr.get(r1)!] || 0) + 1;
      r32Opp[mid][gr.get(r2)!] = (r32Opp[mid][gr.get(r2)!] || 0) + 1;
    }
    const avail = [...q3g];
    for (const [mid, w] of w3Pairs) {
      const idx = avail.findIndex(g => g !== w);
      if (idx < 0) continue;
      const tg = avail.splice(idx, 1)[0];
      const t3 = q3.find(x => x.group === tg)!.team;
      r32Opp[mid][gw.get(w)!] = (r32Opp[mid][gw.get(w)!] || 0) + 1;
      r32Opp[mid][t3] = (r32Opp[mid][t3] || 0) + 1;
    }

    // 4. Simulate knockout → champion
    const r32Winners: Map<string, string> = new Map();
    const allSlots = [...wrPairs, ...rrPairs, ...w3Pairs.map(([mid, w]) => {
      const tg = w3Pairs.findIndex(p => p[0] === mid);
      return [mid, w, q3g[tg] || 'A'] as [string, Group, Group];
    })];

    for (const [mid, w, r] of wrPairs) {
      const wt = gw.get(w)!, rt = gr.get(r)!;
      r32Winners.set(mid, simKO(strength(wt, currentStandings), strength(rt, currentStandings)) === 'home' ? wt : rt);
    }
    for (const [mid, r1, r2] of rrPairs) {
      const t1 = gr.get(r1)!, t2 = gr.get(r2)!;
      r32Winners.set(mid, simKO(strength(t1, currentStandings), strength(t2, currentStandings)) === 'home' ? t1 : t2);
    }
    const used3: string[] = [];
    for (const [mid, w] of w3Pairs) {
      const idx = avail.length > 0 ? 0 : -1;
      const tg = avail.length > 0 ? avail.splice(idx, 1)[0] : q3g[0];
      const wt = gw.get(w)!, rt = q3.find(x => x.group === tg)!.team;
      r32Winners.set(mid, simKO(strength(wt, currentStandings), strength(rt, currentStandings)) === 'home' ? wt : rt);
    }

    const r16 = [['M89','M74','M77'],['M90','M73','M75'],['M91','M76','M78'],['M92','M79','M80'],
                  ['M93','M83','M84'],['M94','M81','M82'],['M95','M86','M88'],['M96','M85','M87']];
    const qfW: string[] = [];
    for (const [, m1, m2] of r16) {
      const t1 = r32Winners.get(m1)!, t2 = r32Winners.get(m2)!;
      qfW.push(simKO(strength(t1, currentStandings), strength(t2, currentStandings)) === 'home' ? t1 : t2);
    }
    const sfW: string[] = [];
    for (let i = 0; i < 4; i += 2) {
      sfW.push(simKO(strength(qfW[i], currentStandings), strength(qfW[i+1], currentStandings)) === 'home' ? qfW[i] : qfW[i+1]);
    }
    const champ = simKO(strength(sfW[0], currentStandings), strength(sfW[1], currentStandings)) === 'home' ? sfW[0] : sfW[1];
    champCount[champ]++;
  }

  // ── Format results ──
  const groupProbs: GroupProbs[] = GROUPS.map(g => ({
    group: g,
    teams: TEAMS[g].map(name => {
      const c = posCount[g][name];
      return {
        name,
        first: +(c[0] / SIMS * 100).toFixed(1),
        second: +(c[1] / SIMS * 100).toFixed(1),
        third: +(c[2] / SIMS * 100).toFixed(1),
        fourth: +(c[3] / SIMS * 100).toFixed(1),
      };
    }),
  }));

  const opponentProbs: OpponentProb[] = R32_BRACKET.map(s => {
    const opp = r32Opp[s.matchId];
    const sorted = Object.entries(opp)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8)
      .map(([team, count]) => ({ team, prob: +(count / SIMS * 100).toFixed(1) }));
    return { matchId: s.matchId, slot: `${s.home}-${s.away}`, opponents: sorted };
  });

  const champion = Object.entries(champCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 15)
    .map(([team, count]) => ({ team, probability: +(count / SIMS * 100).toFixed(1) }));

  return { groupProbs, opponentProbs, champion, totalSims: SIMS };
}
