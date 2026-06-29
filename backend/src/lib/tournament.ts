// 2026 World Cup tournament structure
// Verified against 懂球帝 official bracket

export const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L'] as const;
export type Group = typeof GROUPS[number];

// 2026 World Cup groups — source: CCTV/央视, verified 2026-04-01
// Format: [Pot1, Pot2, Pot3, Pot4] per group
export const TEAMS: Record<Group, string[]> = {
  A: ['墨西哥', '南非', '韩国', '捷克'],
  B: ['加拿大', '波黑', '卡塔尔', '瑞士'],
  C: ['巴西', '摩洛哥', '海地', '苏格兰'],
  D: ['美国', '巴拉圭', '澳大利亚', '土耳其'],
  E: ['德国', '库拉索', '科特迪瓦', '厄瓜多尔'],
  F: ['荷兰', '日本', '瑞典', '突尼斯'],
  G: ['比利时', '埃及', '伊朗', '新西兰'],
  H: ['西班牙', '佛得角', '沙特', '乌拉圭'],
  I: ['法国', '塞内加尔', '伊拉克', '挪威'],
  J: ['阿根廷', '阿尔及利亚', '奥地利', '约旦'],
  K: ['葡萄牙', '刚果(金)', '乌兹别克斯坦', '哥伦比亚'],
  L: ['英格兰', '克罗地亚', '加纳', '巴拿马'],
};

export interface Match {
  id: string;
  round: 'GROUP' | 'R32' | 'R16' | 'QF' | 'SF' | 'FINAL' | 'THIRD';
  group?: Group;
  home: string | null;  // team name or slot like "1A"
  away: string | null;
  homeScore?: number;
  awayScore?: number;
  date?: string;
  venue?: string;
}

// Group stage: 72 matches with real dates from openligadb (anchored to FIFA schedule)
// Date map: matchId → date. Swap map: matchId → true if home/away needs swap (FIFA order)
let _dateMap: Record<string, string> | null = null;
let _swapMap: Record<string, boolean> | null = null;
export const needSwap = (id: string) => _swapMap?.[id] ?? false;

export async function loadDateMap(): Promise<Record<string, string>> {
  if (_dateMap) return _dateMap;
  try {
    const res = await fetch('https://api.openligadb.de/getmatchdata/wm2026/2026');
    const data = await res.json() as any[];
    _dateMap = {}; _swapMap = {};
    const NAME_MAP: Record<string, string> = {
      'Mexiko':'墨西哥','Südafrika':'南非','Südkorea':'韩国','Tschechien':'捷克',
      'Kanada':'加拿大','Bosnien-Herzegowina':'波黑','Katar':'卡塔尔','Schweiz':'瑞士',
      'Brasilien':'巴西','Marokko':'摩洛哥','Haiti':'海地','Schottland':'苏格兰',
      'USA':'美国','Paraguay':'巴拉圭','Australien':'澳大利亚','Türkei':'土耳其',
      'Deutschland':'德国','Curaçao':'库拉索','Elfenbeinküste':'科特迪瓦','Ecuador':'厄瓜多尔',
      'Niederlande':'荷兰','Japan':'日本','Schweden':'瑞典','Tunesien':'突尼斯',
      'Belgien':'比利时','Ägypten':'埃及','Iran':'伊朗','Neuseeland':'新西兰',
      'Spanien':'西班牙','Kap Verde':'佛得角','Saudi-Arabien':'沙特','Uruguay':'乌拉圭',
      'Frankreich':'法国','Senegal':'塞内加尔','Irak':'伊拉克','Norwegen':'挪威',
      'Argentinien':'阿根廷','Algerien':'阿尔及利亚','Österreich':'奥地利','Jordanien':'约旦',
      'Portugal':'葡萄牙','DR Kongo':'刚果(金)','Usbekistan':'乌兹别克斯坦','Kolumbien':'哥伦比亚',
      'England':'英格兰','Kroatien':'克罗地亚','Ghana':'加纳','Panama':'巴拿马',
    };
    const pairLookup: Record<string, string> = {};
    for (const g of GROUPS) {
      const t = TEAMS[g];
      for (let i = 0; i < 6; i++) {
        const [h, a] = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]][i];
        pairLookup[`${t[h]}::${t[a]}`] = `G-${g}-${i+1}`;
      }
    }
    for (const m of data) {
      const home = NAME_MAP[m.team1.teamName], away = NAME_MAP[m.team2.teamName];
      if (!home || !away) continue;
      const fwd = `${home}::${away}`, rev = `${away}::${home}`;
      const mid = pairLookup[fwd] || pairLookup[rev];
      if (mid) {
        _dateMap![mid] = m.matchDateTime.slice(0, 10);
        _swapMap![mid] = !!pairLookup[rev]; // true if we matched reverse = need swap
      }
    }
    console.log(`[dates] ${Object.keys(_dateMap!).length}/72 matches, ${Object.values(_swapMap!).filter(Boolean).length} swaps`);
  } catch (e) { console.error('Failed to load dates:', e); }
  return _dateMap || {};
}

export function generateGroupMatches(): Match[] {
  const matches: Match[] = [];
  for (const g of GROUPS) {
    const t = TEAMS[g];
    [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]].forEach(([h,a], i) => {
      const id = `G-${g}-${i+1}`;
      // Swap home/away if openligadb order differs — data integrity
      const swap = _swapMap?.[id] ?? false;
      matches.push({
        id, round: 'GROUP', group: g,
        home: swap ? t[a] : t[h],
        away: swap ? t[h] : t[a],
        date: _dateMap?.[id] || `2026-06-${11 + Math.floor(i/2)}`,
      });
    });
  }
  return matches;
}

// Knockout stage: all matches from R32 to Final
// M73-M104 in FIFA official numbering
export function generateKnockoutMatches(): Match[] {
  const matches: Match[] = [];

  // R32 (M73-M88) — CCTV-verified pairings
  const r32Pairs: [string, string, string, string][] = [
    ['M73','南非','加拿大','2026-06-29'], ['M74','德国','巴拉圭','2026-06-30'],
    ['M75','荷兰','摩洛哥','2026-06-30'], ['M76','巴西','日本','2026-06-30'],
    ['M77','法国','瑞典','2026-07-01'], ['M78','科特迪瓦','挪威','2026-07-01'],
    ['M79','墨西哥','厄瓜多尔','2026-07-01'], ['M80','英格兰','刚果(金)','2026-07-02'],
    ['M81','美国','波黑','2026-07-02'], ['M82','比利时','塞内加尔','2026-07-02'],
    ['M83','葡萄牙','克罗地亚','2026-07-03'], ['M84','西班牙','奥地利','2026-07-02'],
    ['M85','瑞士','阿尔及利亚','2026-07-03'], ['M86','阿根廷','佛得角','2026-07-04'],
    ['M87','哥伦比亚','加纳','2026-07-04'], ['M88','澳大利亚','埃及','2026-07-04'],
  ];
  for (const [id, home, away, date] of r32Pairs) {
    matches.push({ id, round: 'R32', home, away, date });
  }

  // R16 (M89-M96), QF (M97-M100), SF (M101-M102), Final (M104), 3rd (M103)
  const later: [string, string, string | null, string | null, string][] = [
    ['M89','R16','','','2026-07-05'],['M90','R16','','','2026-07-05'],['M91','R16','','','2026-07-06'],['M92','R16','','','2026-07-06'],
    ['M93','R16','','','2026-07-07'],['M94','R16','','','2026-07-07'],['M95','R16','','','2026-07-08'],['M96','R16','','','2026-07-08'],
    ['M97','QF','','','2026-07-09'],['M98','QF','','','2026-07-10'],['M99','QF','','','2026-07-11'],['M100','QF','','','2026-07-11'],
    ['M101','SF','','','2026-07-14'],['M102','SF','','','2026-07-15'],
    ['M103','THIRD','','','2026-07-18'],['M104','FINAL','','','2026-07-19'],
  ];
  for (const [id, round, , , date] of later) {
    matches.push({ id, round: round as any, home: null, away: null, date });
  }

  return matches;
}

// R32 bracket mapping (verified against 懂球帝)
interface R32Slot { matchId: string; home: string; away: string; }
export const R32_BRACKET: R32Slot[] = [
  { matchId: 'M73', home: '2A', away: '2B' },{ matchId: 'M74', home: '1E', away: '3?' },
  { matchId: 'M75', home: '1F', away: '2C' },{ matchId: 'M76', home: '1C', away: '2F' },
  { matchId: 'M77', home: '1I', away: '3?' },{ matchId: 'M78', home: '2E', away: '2I' },
  { matchId: 'M79', home: '1A', away: '3?' },{ matchId: 'M80', home: '1L', away: '3?' },
  { matchId: 'M81', home: '1D', away: '3?' },{ matchId: 'M82', home: '1G', away: '3?' },
  { matchId: 'M83', home: '2K', away: '2L' },{ matchId: 'M84', home: '1H', away: '2J' },
  { matchId: 'M85', home: '1B', away: '3?' },{ matchId: 'M86', home: '1J', away: '2H' },
  { matchId: 'M87', home: '1K', away: '3?' },{ matchId: 'M88', home: '2D', away: '2G' },
];

// R32 → R16 → QF → SF → Final path
export const KNOCKOUT_PATH: Record<string, string> = {
  // R32 winners feed into R16
  M74: 'M89', M77: 'M89',
  M73: 'M90', M75: 'M90',
  M76: 'M91', M78: 'M91',
  M79: 'M92', M80: 'M92',
  M83: 'M93', M84: 'M93',
  M81: 'M94', M82: 'M94',
  M86: 'M95', M88: 'M95',
  M85: 'M96', M87: 'M96',
  // R16 → QF
  M89: 'M97', M90: 'M97',
  M93: 'M98', M94: 'M98',
  M91: 'M99', M92: 'M99',
  M95: 'M100', M96: 'M100',
  // QF → SF
  M97: 'M101', M98: 'M101',
  M99: 'M102', M100: 'M102',
  // SF → Final/3rd
  M101: 'M104', M102: 'M104',
};

// Best 3rd-place → Group Winner mapping (FIFA Annex C)
// Given the set of 8 qualifying 3rd-place groups (sorted alphabetically),
// maps to the 8 R32 matches that pair winners vs 3rd-place teams.
// Table: for each possible qualifying combination, which 3rd goes where
// Simplified for MVP: static order, conflict resolution handled at runtime
export const THIRD_PLACE_MATCHES = ['M74','M77','M79','M80','M81','M82','M85','M87'] as const;

export function resolveThirdPlaceMapping(qualifyingThirdGroups: Group[]): Record<string, Group> {
  const sorted = [...qualifyingThirdGroups].sort();
  const mapping: Record<string, Group> = {};
  const used = new Set<Group>();

  for (const matchId of THIRD_PLACE_MATCHES) {
    const slot = R32_BRACKET.find(s => s.matchId === matchId)!;
    const winnerGroup = slot.home.charAt(1) as Group; // e.g., "1E" → "E"

    // Find first available 3rd-place group not conflicting with winner
    for (const g of sorted) {
      if (!used.has(g) && g !== winnerGroup) {
        mapping[matchId] = g;
        used.add(g);
        break;
      }
    }
  }
  return mapping;
}
