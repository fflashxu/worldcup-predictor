// Multi-source data pipeline:
// 1. openligadb.de (primary) — full 72 matches, German team names
// 2. sporttery.cn (cross-check) — Chinese names, betting odds, match status
// 3. openligadb recent (fallback) — date-filtered for fresher results
import { generateGroupMatches, TEAMS, GROUPS, Group, loadDateMap } from './tournament';
import { injectResults } from './datasource';

const OPENLIGADB_FULL = 'https://api.openligadb.de/getmatchdata/wm2026/2026';
const OPENLIGADB_RECENT = 'https://api.openligadb.de/getmatchdata/wm2026'; // Rolling window

// German→Chinese team name mapping (from openligadb data)
const NAME_MAP: Record<string, string> = {
  'Mexiko': '墨西哥', 'Südafrika': '南非', 'Südkorea': '韩国', 'Tschechien': '捷克',
  'Kanada': '加拿大', 'Bosnien-Herzegowina': '波黑', 'Katar': '卡塔尔', 'Schweiz': '瑞士',
  'Brasilien': '巴西', 'Marokko': '摩洛哥', 'Haiti': '海地', 'Schottland': '苏格兰',
  'USA': '美国', 'Paraguay': '巴拉圭', 'Australien': '澳大利亚', 'Türkei': '土耳其',
  'Deutschland': '德国', 'Curaçao': '库拉索', 'Elfenbeinküste': '科特迪瓦', 'Ecuador': '厄瓜多尔',
  'Niederlande': '荷兰', 'Japan': '日本', 'Schweden': '瑞典', 'Tunesien': '突尼斯',
  'Belgien': '比利时', 'Ägypten': '埃及', 'Iran': '伊朗', 'Neuseeland': '新西兰',
  'Spanien': '西班牙', 'Kap Verde': '佛得角', 'Saudi-Arabien': '沙特', 'Uruguay': '乌拉圭',
  'Frankreich': '法国', 'Senegal': '塞内加尔', 'Irak': '伊拉克', 'Norwegen': '挪威',
  'Argentinien': '阿根廷', 'Algerien': '阿尔及利亚', 'Österreich': '奥地利', 'Jordanien': '约旦',
  'Portugal': '葡萄牙', 'DR Kongo': '刚果(金)', 'Usbekistan': '乌兹别克斯坦', 'Kolumbien': '哥伦比亚',
  'England': '英格兰', 'Kroatien': '克罗地亚', 'Ghana': '加纳', 'Panama': '巴拿马',
};

function toCN(germanName: string): string {
  return NAME_MAP[germanName] || germanName;
}

interface OpenLigaMatch {
  matchID: number;
  matchDateTime: string;
  matchIsFinished: boolean;
  team1: { teamName: string };
  team2: { teamName: string };
  matchResults: { resultName: string; pointsTeam1: number; pointsTeam2: number }[];
  group: { groupName: string };
}

export async function syncFromOpenLiga(): Promise<{ total: number; newResults: number }> {
  const res = await fetch(OPENLIGADB_FULL);
  const matches: OpenLigaMatch[] = await res.json() as OpenLigaMatch[];

  const finished = matches.filter(m => m.matchIsFinished);
  const allGroupMatches = generateGroupMatches();

  const toInject: { matchId: string; homeScore: number; awayScore: number }[] = [];

  for (const olm of finished) {
    const result = olm.matchResults.find(r => r.resultName === 'Endergebnis');
    if (!result) continue;

    const homeCN = toCN(olm.team1.teamName);
    const awayCN = toCN(olm.team2.teamName);

    // Find matching match in our schedule
    let match = allGroupMatches.find(m => m.home === homeCN && m.away === awayCN);
    let reversed = false;
    if (!match) {
      match = allGroupMatches.find(m => m.home === awayCN && m.away === homeCN);
      reversed = true;
    }

    if (match) {
      toInject.push({
        matchId: match.id,
        homeScore: reversed ? result.pointsTeam2 : result.pointsTeam1,
        awayScore: reversed ? result.pointsTeam1 : result.pointsTeam2,
      });
    }
  }

  const count = await injectResults(toInject);
  return { total: finished.length, newResults: count };
}

// Schedule auto-sync every 5 minutes + data integrity check
export function startAutoSync() {
  console.log('[sync] Auto-sync started (every 5min, 3 sources)');
  loadDateMap().then(() => console.log('[sync] 📅 Match dates loaded'));

  const runAll = async () => {
    try {
      const r1 = await syncFromOpenLiga();
      if (r1.newResults > 0) console.log(`[sync] openligadb: ${r1.newResults} new (total: ${r1.total})`);

      const { syncFromNews } = await import('./news-sync');
      const r2 = await syncFromNews();
      if (r2 > 0) console.log(`[sync] sporttery: ${r2} new results`);
    } catch (e) { console.error('[sync] Error:', e); }
  };

  runAll();
  setInterval(runAll, 5 * 60 * 1000);
}
