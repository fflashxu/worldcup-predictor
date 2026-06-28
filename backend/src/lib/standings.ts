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

// R32 bracket: CCTV-verified matchups (group stage completed 6/27)
// Source: https://worldcup.cctv.com/2026/schedule/ tab=4
export async function resolveBracket(): Promise<{
  slot: typeof R32_BRACKET[0];
  homeTeam: string | null;
  awayTeam: string | null;
}[]> {
  const { groupWinners, groupRunnersUp, qualifyingThirds } = await computeKnockoutSlots();
  const wm = new Map(groupWinners.map(w => [w.group, w.name]));
  const rm = new Map(groupRunnersUp.map(r => [r.group, r.name]));

  // CCTV-verified R32 pairings (from FIFA official, confirmed by 央视)
  const pairs: [string, string, string][] = [
    ['M73', '2A', '2B'],    // 南非 vs 加拿大
    ['M74', '1E', '3D'],    // 德国 vs 巴拉圭
    ['M75', '1F', '2C'],    // 荷兰 vs 摩洛哥
    ['M76', '1C', '2F'],    // 巴西 vs 日本
    ['M77', '1I', '3F'],    // 法国 vs 瑞典
    ['M78', '2E', '2I'],    // 科特迪瓦 vs 挪威
    ['M79', '1A', '3E'],    // 墨西哥 vs 厄瓜多尔
    ['M80', '1L', '3K'],    // 英格兰 vs 刚果(金)
    ['M81', '1D', '3B'],    // 美国 vs 波黑
    ['M82', '1G', '3I'],    // 比利时 vs 塞内加尔
    ['M83', '2K', '2L'],    // 葡萄牙 vs 克罗地亚
    ['M84', '1H', '2J'],    // 西班牙 vs 奥地利
    ['M85', '1B', '3J'],    // 瑞士 vs 阿尔及利亚
    ['M86', '1J', '2H'],    // 阿根廷 vs 佛得角
    ['M87', '1K', '3L'],    // 哥伦比亚 vs 加纳
    ['M88', '2D', '2G'],    // 澳大利亚 vs 埃及
  ];

  return pairs.map(([matchId, slotHome, slotAway]) => {
    // Extract group letter from slot code: "1A"→"A", "2B"→"B", "3D"→"D"
    const gHome = slotHome.slice(-1);
    const gAway = slotAway.slice(-1);
    const homeTeam = slotHome.startsWith('1') ? wm.get(gHome) || gHome
      : slotHome.startsWith('2') ? rm.get(gHome) || gHome
      : qualifyingThirds.find(t => t.group === gAway)?.name || gHome;
    // For 3? slots, the third-place team is determined by the CCTV-confirmed pairing
    const awayTeam = slotAway.startsWith('1') ? wm.get(gAway) || gAway
      : slotAway.startsWith('2') ? rm.get(gAway) || gAway
      : qualifyingThirds.find(t => t.group === gAway)?.name || gAway;

    // For winner-3rd matches: home is the group winner, away is the specific 3rd-place team
    const hTeam = slotHome.startsWith('3')
      ? qualifyingThirds.find(t => t.group === gHome)?.name || gHome
      : slotHome.startsWith('1') ? wm.get(gHome) || gHome
      : rm.get(gHome) || gHome;
    const aTeam = slotAway.startsWith('3')
      ? qualifyingThirds.find(t => t.group === gAway)?.name || gAway
      : slotAway.startsWith('1') ? wm.get(gAway) || gAway
      : rm.get(gAway) || gAway;

    return {
      slot: R32_BRACKET.find(s => s.matchId === matchId)!,
      homeTeam: hTeam,
      awayTeam: aTeam,
    };
  });
}
