import { prisma } from './prisma';
import { generateGroupMatches, GROUPS, TEAMS, Group, Match, R32_BRACKET, THIRD_PLACE_MATCHES } from './tournament';

interface TeamStanding {
  name: string;
  pts: number;
  gd: number;
  gf: number;
  ga: number;
  played: number;
  group: Group;
  position: number; // 1-4 in group
}

// Compute current group standings from real results
export async function computeStandings(): Promise<Record<Group, TeamStanding[]>> {
  const allMatches = generateGroupMatches();
  const results = await prisma.prediction.findMany({
    where: { predictedBy: 'result' },
  });

  const standings: Record<string, TeamStanding[]> = {};
  for (const g of GROUPS) {
    standings[g] = TEAMS[g].map(name => ({
      name, pts: 0, gd: 0, gf: 0, ga: 0, played: 0, group: g, position: 0,
    }));
  }

  for (const m of allMatches) {
    const result = results.find(r => r.matchId === m.id);
    if (!result) continue;
    if (!m.group) continue;
    const home = standings[m.group].find(t => t.name === m.home);
    const away = standings[m.group].find(t => t.name === m.away);
    if (!home || !away) continue;

    home.played++; away.played++;
    home.gf += result.homeScore; home.ga += result.awayScore;
    away.gf += result.awayScore; away.ga += result.homeScore;
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;

    if (result.homeScore > result.awayScore) home.pts += 3;
    else if (result.awayScore > result.homeScore) away.pts += 3;
    else { home.pts += 1; away.pts += 1; }
  }

  // Sort each group: Pts → GD → GF → alphabetical
  for (const g of GROUPS) {
    standings[g].sort((a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf ||
      a.name.localeCompare(b.name)
    );
    standings[g].forEach((t, i) => t.position = i + 1);
  }

  return standings;
}

// Determine who advances: group winners + runners-up + 8 best 3rd place
export async function computeKnockoutSlots(): Promise<{
  groupWinners: TeamStanding[];
  groupRunnersUp: TeamStanding[];
  thirdPlaceTeams: TeamStanding[];
  qualifyingThirds: TeamStanding[];
}> {
  const standings = await computeStandings();

  const winners: TeamStanding[] = [];
  const runnersUp: TeamStanding[] = [];
  const thirdPlace: TeamStanding[] = [];

  for (const g of GROUPS) {
    const s = standings[g];
    winners.push(s[0]);
    runnersUp.push(s[1]);
    thirdPlace.push(s[2]);
  }

  // Sort 3rd place teams: Pts → GD → GF
  thirdPlace.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  const qualifyingThirds = thirdPlace.slice(0, 8);

  return { groupWinners: winners, groupRunnersUp: runnersUp, thirdPlaceTeams: thirdPlace, qualifyingThirds };
}

// Resolve R32 bracket with actual teams
export async function resolveBracket(): Promise<{
  slot: typeof R32_BRACKET[0];
  homeTeam: string | null;
  awayTeam: string | null;
}[]> {
  const { groupWinners, groupRunnersUp, qualifyingThirds } = await computeKnockoutSlots();

  const winnerMap = new Map(groupWinners.map(w => [w.group, w]));
  const runnerMap = new Map(groupRunnersUp.map(r => [r.group, r]));
  const thirdGroups = qualifyingThirds.map(t => t.group).sort();

  const bracket: { slot: typeof R32_BRACKET[0]; homeTeam: string | null; awayTeam: string | null }[] = [];

  // Match 4 fixed Winner vs Runner-up pairs
  // M75: Winner F vs Runner-up C,  M76: Winner C vs Runner-up F
  // M84: Winner H vs Runner-up J,  M86: Winner J vs Runner-up H
  const fixedPairs = [
    { matchId: 'M75', w: 'F', r: 'C' },
    { matchId: 'M76', w: 'C', r: 'F' },
    { matchId: 'M84', w: 'H', r: 'J' },
    { matchId: 'M86', w: 'J', r: 'H' },
  ];

  // 4 Runner-up vs Runner-up matches
  // M73: 2A vs 2B, M78: 2E vs 2I, M83: 2K vs 2L, M88: 2D vs 2G
  const rrPairs = [
    { matchId: 'M73', r1: 'A', r2: 'B' },
    { matchId: 'M78', r1: 'E', r2: 'I' },
    { matchId: 'M83', r1: 'K', r2: 'L' },
    { matchId: 'M88', r1: 'D', r2: 'G' },
  ];

  // Winner vs 3rd place: M74, M77, M79, M80, M81, M82, M85, M87
  // Map qualifying 3rd groups to matches using Annex C logic
  const w3Matches = [
    { matchId: 'M74', w: 'E' },
    { matchId: 'M77', w: 'I' },
    { matchId: 'M79', w: 'A' },
    { matchId: 'M80', w: 'L' },
    { matchId: 'M81', w: 'D' },
    { matchId: 'M82', w: 'G' },
    { matchId: 'M85', w: 'B' },
    { matchId: 'M87', w: 'K' },
  ];

  // Annex C: assign 3rd-place teams to winner-3rd matches
  // Sort qualifying 3rd-place groups alphabetically
  const available = [...thirdGroups].sort();
  const assignments: { matchId: string; thirdGroup: string }[] = [];
  const used = new Set<string>();

  // Try to assign each 3rd-place group to a match, avoiding same-group conflicts
  function assign() {
    assignments.length = 0;
    used.clear();
    const remaining = [...available];
    for (const wm of w3Matches) {
      // Find first available third not from same group as winner
      const idx = remaining.findIndex(g => g !== wm.w);
      if (idx < 0) return false; // no valid assignment
      const g = remaining.splice(idx, 1)[0];
      assignments.push({ matchId: wm.matchId, thirdGroup: g });
    }
    return true;
  }

  // If simple assignment fails, swap adjacent to resolve conflicts
  if (!assign()) {
    // Try with different sorting orders until all 8 match
    for (let attempt = 0; attempt < 10; attempt++) {
      // Rotate the first element to try different mappings
      available.push(available.shift()!);
      if (assign()) break;
    }
  }

  for (const a of assignments) {
    const thirdTeam = qualifyingThirds.find(t => t.group === a.thirdGroup);
    bracket.push({
      slot: R32_BRACKET.find(s => s.matchId === a.matchId)!,
      homeTeam: winnerMap.get(w3Matches.find(wm => wm.matchId === a.matchId)?.w as Group)?.name || '?',
      awayTeam: thirdTeam?.name || `3${a.thirdGroup}`,
    });
  }

  // Winner-Runner matches
  for (const fp of fixedPairs) {
    bracket.push({
      slot: R32_BRACKET.find(s => s.matchId === fp.matchId)!,
      homeTeam: winnerMap.get(fp.w as Group)?.name || `1${fp.w}`,
      awayTeam: runnerMap.get(fp.r as Group)?.name || `2${fp.r}`,
    });
  }

  // Runner-Runner matches
  for (const rr of rrPairs) {
    bracket.push({
      slot: R32_BRACKET.find(s => s.matchId === rr.matchId)!,
      homeTeam: runnerMap.get(rr.r1 as Group)?.name || `2${rr.r1}`,
      awayTeam: runnerMap.get(rr.r2 as Group)?.name || `2${rr.r2}`,
    });
  }

  // Sort by match ID
  bracket.sort((a, b) => a.slot.matchId.localeCompare(b.slot.matchId));
  return bracket;
}
