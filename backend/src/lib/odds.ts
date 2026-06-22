// 中国体育彩票 竞彩足球赔率 — 独立数据源，不与MC交叉
const LOTTERY_API = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had&channel=c';

interface LotteryMatch {
  homeTeamAllName: string;
  awayTeamAllName: string;
  matchDate: string;
  matchTime: string;
  homeRank: string;
  awayRank: string;
  leagueAbbName: string;
  had?: { h: string; d: string; a: string };
  hhad?: { h: string; d: string; a: string; goalLine: string };
  sellStatus: number;
}

interface MatchOdds {
  homeWin: number;    // probability from implied odds (0-100)
  draw: number;
  awayWin: number;
  handicapGoalLine: string;  // e.g. "-1"
  handicapOdds: string;      // e.g. "2.11/3.25/2.88"
  source: 'sporttery';
}

// Map 体彩 Chinese names → our Chinese names
const NAME_ALIAS: Record<string, string> = {
  '韩国': '韩国', '阿根廷': '阿根廷', '奥地利': '奥地利',
  // Add more if needed; most names match our system directly
};

function normalizeName(name: string): string {
  return NAME_ALIAS[name] || name;
}

export async function fetchOdds(): Promise<Record<string, MatchOdds>> {
  const res = await fetch(LOTTERY_API);
  const data: any = await res.json();
  if (data.errorCode !== '0') throw new Error(`Lottery API error: ${data.errorMessage || data.errorCode}`);

  const allMatches: LotteryMatch[] = [];
  for (const day of data.value.matchInfoList || []) {
    for (const m of day.subMatchList || []) {
      if (m.leagueAbbName === '世界杯') allMatches.push(m);
    }
  }

  const odds: Record<string, MatchOdds> = {};
  for (const m of allMatches) {
    const home = normalizeName(m.homeTeamAllName);
    const away = normalizeName(m.awayTeamAllName);
    const key = `${home}::${away}`;

    if (m.had) {
      // Convert betting odds to implied probabilities (removing margin)
      const h = 1 / parseFloat(m.had.h);
      const d = 1 / parseFloat(m.had.d);
      const a = 1 / parseFloat(m.had.a);
      const total = h + d + a;
      odds[key] = {
        homeWin: +(h / total * 100).toFixed(1),
        draw: +(d / total * 100).toFixed(1),
        awayWin: +(a / total * 100).toFixed(1),
        handicapGoalLine: m.hhad?.goalLine || '',
        handicapOdds: m.hhad ? `${m.hhad.h}/${m.hhad.d}/${m.hhad.a}` : '',
        source: 'sporttery',
      };
    }
  }
  return odds;
}
