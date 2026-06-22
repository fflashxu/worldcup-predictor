import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState } from 'react';
import { flag } from './lib/flags';

const api = axios.create({ baseURL: '/api' });
type Tab = 'schedule' | 'groups' | 'bracket';

interface Standing { name: string; pts: number; gd: number; gf: number; played: number; position: number; }
interface Prediction { id: string; matchId: string; homeScore: number; awayScore: number; predictedBy: string; }
interface Match { id: string; round: string; group?: string; home: string | null; away: string | null; homeScore?: number; awayScore?: number; completed?: boolean; }

function GroupCard({ letter, teams, standings }: { letter: string; teams: string[]; standings?: Standing[] }) {
  // Sort by standings position (pts desc), fall back to original order
  const sorted = standings
    ? [...standings].sort((a, b) => a.position - b.position)
    : teams.map((name, i) => ({ name, pts: 0, gd: 0, gf: 0, played: 0, position: i + 1 }) as Standing);
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-sky-600 text-white text-center py-1 text-sm font-bold">{letter} 组</div>
      {sorted.map((t, i) => (
        <div key={t.name} className={`flex items-center gap-1 px-2 py-1 text-xs ${i < 2 ? 'bg-emerald-50/60' : i === 2 ? 'bg-amber-50/40' : ''}`}>
          <span className="w-3 text-slate-400 text-[10px]">{t.position}</span>
          <span>{flag(t.name)}</span>
          <span className="flex-1 truncate">{t.name}</span>
          <span className="text-slate-500 font-mono text-[10px]">{t.pts}分</span>
        </div>
      ))}
    </div>
  );
}

function TeamLine({ name, slot }: { name: string | null; slot: string }) {
  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-slate-300 w-7 text-[10px] font-mono">{slot}</span>
      {name ? <><span>{flag(name)}</span><span className="truncate">{name}</span></> : <span className="text-slate-300">待定</span>}
    </span>
  );
}

function R32Row({ id, slot1, slot2, t1, t2 }: {
  id: string; slot1: string; slot2: string; t1: string | null; t2: string | null;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded px-2 py-1.5 min-w-[160px]">
      <TeamLine name={t1} slot={slot1} />
      <div className="border-t border-slate-100 my-1"></div>
      <TeamLine name={t2} slot={slot2} />
    </div>
  );
}

function MatchCard({ m, preds, onUserPredict, onMC, onDS }: {
  m: any; preds: Prediction[];
  onUserPredict: (h: number, a: number) => void;  // auto-advances variant
  onMC: () => Promise<any>; onDS: () => Promise<any>;
}) {
  const [uh, setUh] = useState(0);
  const [ua, setUa] = useState(0);
  const [mcLoading, setMcLoading] = useState(false);
  const [dsLoading, setDsLoading] = useState(false);
  const mcPreds = preds.filter(p => p.predictedBy === 'mc');
  const dsPreds = preds.filter(p => p.predictedBy === 'ds');
  const userPreds = preds.filter(p => p.predictedBy === 'user').sort((a,b) => (a.variant||1)-(b.variant||1));
  const usedCount = userPreds.length;
  const remaining = 3 - usedCount;
  const ok = (h: number, a: number) => m.completed && h === m.homeScore && a === m.awayScore;
  return (
    <div className={`rounded-lg border p-2 text-xs ${m.completed ? 'bg-emerald-50/30 border-emerald-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-1">
        <span className="w-20 truncate text-right text-[11px]">{flag(m.home)} {m.home}</span>
        {m.completed ? (
          <span className="font-mono font-bold text-emerald-700 shrink-0 px-2">{m.homeScore}-{m.awayScore}</span>
        ) : (
          <>
            <input type="number" min={0} max={15} value={uh} onChange={e => setUh(Number(e.target.value))}
              className="w-7 text-center border border-slate-300 rounded text-[11px] py-0.5" />
            <span className="text-slate-400">-</span>
            <input type="number" min={0} max={15} value={ua} onChange={e => setUa(Number(e.target.value))}
              className="w-7 text-center border border-slate-300 rounded text-[11px] py-0.5" />
          </>
        )}
        <span className="w-20 truncate text-[11px]">{flag(m.away)} {m.away}</span>
        {!m.completed && remaining > 0 && (
          <button onClick={() => { onUserPredict(uh, ua); setUh(0); setUa(0); }}
            className="text-[10px] bg-sky-500 hover:bg-sky-600 text-white px-1.5 py-0.5 rounded shrink-0">
            👤×{remaining}</button>
        )}
        {!m.completed && remaining === 0 && <span className="text-[10px] text-slate-400">👤已用完</span>}
      </div>
      {/* Predictions row */}
      <div className="flex items-center gap-1 mt-1.5 text-[10px]">
        <button onClick={async () => { setMcLoading(true); await onMC(); setMcLoading(false); }} disabled={m.completed || mcLoading}
          className={`shrink-0 px-1 rounded ${mcLoading ? 'text-sky-400 animate-pulse' : 'text-sky-600 hover:bg-sky-50'}`}>📊</button>
        {mcPreds.map(p => <span key={p.variant} className={`font-mono ${ok(p.homeScore,p.awayScore)?'text-emerald-600 font-bold':'text-slate-400'}`}>{p.homeScore}-{p.awayScore}</span>)}
        {userPreds.map(p => <span key={`u${p.variant}`} className={`font-mono ${ok(p.homeScore,p.awayScore)?'text-emerald-600 font-bold':'text-slate-400'}`}>👤{p.homeScore}-{p.awayScore}</span>)}
        <span className="flex-1"></span>
        <button onClick={async () => { setDsLoading(true); await onDS(); setDsLoading(false); }} disabled={m.completed || dsLoading}
          className={`shrink-0 px-1 rounded ${dsLoading?'text-purple-400 animate-pulse':'text-purple-600 hover:bg-purple-50'}`}>🧠</button>
        {dsPreds.map(p => <span key={p.variant} className={`font-mono ${ok(p.homeScore,p.awayScore)?'text-emerald-600 font-bold':'text-slate-400'}`}>{p.homeScore}-{p.awayScore}</span>)}
      </div>
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('groups');
  const [aiLoading, setAiLoading] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>('A');

  const { data: t } = useQuery({ queryKey: ['tournament'], queryFn: () => api.get('/tournament').then(r => r.data) });
  const { data: standings } = useQuery({ queryKey: ['standings'], queryFn: () => api.get('/standings').then(r => r.data as Record<string, Standing[]>) });
  const { data: bracket } = useQuery({ queryKey: ['bracket'], queryFn: () => api.get('/bracket').then(r => r.data) });
  const { data: schedule } = useQuery({ queryKey: ['schedule'], queryFn: () => api.get('/schedule').then(r => r.data) });
  const { data: mc } = useQuery({ queryKey: ['champion'], queryFn: () => api.get('/champion').then(r => r.data), refetchInterval: 60000 });

  const { data: preds } = useQuery({ queryKey: ['predictions'], queryFn: () => api.get('/predictions').then(r => r.data as Prediction[]) });

  const submit = useMutation({
    mutationFn: (d: { matchId: string; homeScore: number; awayScore: number; predictedBy?: string }) => api.post('/predict', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['predictions'] }),
  });
  const triggerAI = useMutation({
    mutationFn: (matchId?: string) => api.post('/predict/ai', matchId ? { matchId } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['predictions'] }); setAiLoading(false); },
    onError: () => { setAiLoading(false); },
  });

  const getPred = (matchId: string, type: string) => preds?.find((p: Prediction) => p.matchId === matchId && p.predictedBy === type);
  const { data: accuracy } = useQuery({ queryKey: ['accuracy'], queryFn: () => api.get('/accuracy').then(r => r.data) });

  const r32 = ((bracket?.bracket || []) as any[]).reduce((acc: any, s: any) => {
    acc[s.slot.matchId] = s; return acc;
  }, {});

  // Build opponent probability lookup: matchId → [{team, prob}]
  const oppLookup: Record<string, any[]> = {};
  mc?.opponentProbs?.forEach((op: any) => { oppLookup[op.matchId] = op.opponents; });
  // →M101上半区: M74+M77→M89, M73+M75→M90→M97  +  M83+M84→M93, M81+M82→M94→M98
  const upperLeft = ['M74','M77','M76','M78'];
  const upperRight = ['M73','M75','M79','M80'];
  // →M102下半区: M76+M78→M91, M79+M80→M92→M99  +  M86+M88→M95, M85+M87→M96→M100
  const lowerLeft = ['M83','M84','M86','M88'];
  const lowerRight = ['M81','M82','M85','M87'];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-lg font-bold text-sky-600">⚽ 2026 世界杯预测</span>
            <nav className="flex gap-1">
              {(['schedule', 'groups', 'bracket'] as Tab[]).map(t_ => (
                <button key={t_} onClick={() => setTab(t_)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t_ ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                  {t_ === 'schedule' ? '赛程' : t_ === 'groups' ? '小组赛 & 积分' : '淘汰赛对阵'}
                </button>
              ))}
            </nav>
          </div>
          <span className="text-xs text-slate-400">📊 MC数学 | 🧠 DeepSeek | 👤 你的预测 — 每场可独立触发</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* SCHEDULE */}
        {tab === 'schedule' && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-500">全部赛程 · {schedule?.totalCompleted || 0}/{schedule?.matches?.length || 72} 场已完成</h2>
              <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                <div className="bg-sky-500 h-1.5 rounded-full transition-all" style={{width: `${((schedule?.totalCompleted||0)/72*100)}%`}}></div>
              </div>
            </div>
            {schedule?.byDate && Object.entries(schedule.byDate as Record<string, any[]>)
              .sort(([a],[b]) => a.localeCompare(b))
              .map(([date, matches]) => (
                <div key={date}>
                  <div className="text-xs font-semibold text-slate-500 mb-2 sticky top-12 bg-slate-50 py-1">{date}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {matches.map((m: any) => (
                      <MatchCard key={m.id} m={m} preds={preds?.filter((p: Prediction) => p.matchId === m.id) || []}
                        onUserPredict={(h, a) => {
                          const ups = (preds || []).filter((p: Prediction) => p.matchId === m.id && p.predictedBy === 'user');
                          const nextVariant = Math.min(3, ups.length + 1);
                          submit.mutate({ matchId: m.id, homeScore: h, awayScore: a, predictedBy: 'user', variant: nextVariant });
                        }}
                        onMC={() => api.post(`/predict/mc/${m.id}`).then(() => qc.invalidateQueries({ queryKey: ['predictions'] }))}
                        onDS={() => api.post(`/predict/ds/${m.id}`).then(() => qc.invalidateQueries({ queryKey: ['predictions'] }))}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {tab === 'groups' && (
          <div className="space-y-6">
            <div className="flex gap-1 flex-wrap">
              {'ABCDEFGHIJKL'.split('').map(g => (
                <button key={g} onClick={() => setActiveGroup(g)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    activeGroup === g ? 'bg-sky-500 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
                  {g} 组
                </button>
              ))}
            </div>

            {/* Standings Table with Position Probabilities */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 text-[11px] bg-slate-50">
                    <th className="p-2.5 text-left w-8">#</th>
                    <th className="p-2.5 text-left">球队</th>
                    <th className="p-2.5 text-center">赛</th>
                    <th className="p-2.5 text-center">进/失</th>
                    <th className="p-2.5 text-center">净胜</th>
                    <th className="p-2.5 text-center font-semibold text-slate-700">分</th>
                    <th className="p-2.5 text-center w-[60px]" title="小组第1概率">🥇</th>
                    <th className="p-2.5 text-center w-[60px]" title="小组第2概率">🥈</th>
                    <th className="p-2.5 text-center w-[60px]" title="小组第3概率">⚡</th>
                    <th className="p-2.5 text-center w-[60px]" title="小组第4概率">4th</th>
                  </tr>
                </thead>
                <tbody>
                  {(standings?.[activeGroup] || []).map((t, i) => {
                    const gp = mc?.groupProbs?.find((x: any) => x.group === activeGroup);
                    const probs = gp?.teams?.find((x: any) => x.name === t.name);
                    return (
                      <tr key={t.name} className={`border-b border-slate-100 ${i < 2 ? 'bg-emerald-50/50' : i === 2 ? 'bg-amber-50/30' : ''}`}>
                        <td className="p-2.5 text-slate-400">{t.position}</td>
                        <td className="p-2.5 font-medium text-slate-700">
                          {flag(t.name)} {t.name}
                          {i < 2 && <span className="ml-1 text-emerald-500 text-xs font-bold">✓</span>}
                        </td>
                        <td className="p-2.5 text-center text-slate-400">{t.played}</td>
                        <td className="p-2.5 text-center text-slate-600">{t.gf}:{t.ga}</td>
                        <td className="p-2.5 text-center text-slate-600">{t.gd > 0 ? '+' : ''}{t.gd}</td>
                        <td className="p-2.5 text-center font-bold text-slate-800">{t.pts}</td>
                        {['first','second','third','fourth'].map(pos => (
                          <td key={pos} className="p-2.5 text-center">
                            {probs ? (
                              <div className="flex flex-col items-center">
                                <span className={`text-[11px] font-mono font-bold ${
                                  probs[pos] > 50 ? 'text-emerald-600' : probs[pos] > 20 ? 'text-sky-600' : 'text-slate-400'
                                }`}>{probs[pos]}%</span>
                                <div className="w-full bg-slate-100 rounded-full h-1 mt-0.5">
                                  <div className={`h-1 rounded-full ${pos === 'first' ? 'bg-yellow-400' : pos === 'second' ? 'bg-sky-400' : pos === 'third' ? 'bg-amber-400' : 'bg-slate-300'}`}
                                    style={{width: `${probs[pos]}%`}}></div>
                                </div>
                              </div>
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* All groups grid */}
            <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
              {'ABCDEFGHIJKL'.split('').map(g => (
                <GroupCard key={g} letter={g} teams={t?.groups?.[g] || []} standings={standings?.[g]} />
              ))}
            </div>
          </div>
        )}

        {tab === 'bracket' && (
          <div className="space-y-6">
            <h2 className="text-sm font-semibold text-slate-500">淘汰赛对阵图 · 基于积分榜实时推演</h2>

            {/* Champion + Opponent Probabilities */}
            {mc && (
              <>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-slate-600 mb-3">🏆 夺冠概率 · Monte Carlo {mc.totalSims}次模拟</h3>
                  <div className="flex gap-1 items-end h-32">
                    {mc.champion.slice(0, 12).map((t: any, i: number) => (
                      <div key={t.team} className="flex-1 flex flex-col items-center gap-1 min-w-[50px]">
                        <span className="text-[10px] font-bold text-slate-600">{t.probability}%</span>
                        <div className={`w-full rounded-t ${i === 0 ? 'bg-yellow-400' : i < 3 ? 'bg-sky-400' : 'bg-slate-300'}`}
                          style={{ height: `${Math.max(t.probability * 3, 4)}px` }}></div>
                        <span className="text-[10px] text-slate-500 text-center leading-tight">{flag(t.team)}<br/>{t.team}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Group qualification summary */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-slate-600 mb-3">📋 小组出线概率 · 前2直接晋级 第3待定</h3>
                  <div className="grid grid-cols-4 md:grid-cols-6 gap-2 text-[11px]">
                    {mc?.groupProbs?.map((gp: any) => (
                      <div key={gp.group} className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                        <div className="font-bold text-slate-700 mb-1">{gp.group} 组</div>
                        {gp.teams.slice(0, 2).map((t: any) => (
                          <div key={t.name} className="flex items-center gap-1 truncate">
                            <span>{flag(t.name)}</span>
                            <span className="flex-1 truncate">{t.name}</span>
                            <span className="font-mono text-emerald-600 font-bold">{t.first}%</span>
                          </div>
                        ))}
                        <div className="text-[10px] text-amber-600 mt-0.5 border-t border-slate-200 pt-0.5 truncate">
                          {gp.teams[2] && `${flag(gp.teams[2].name)}${gp.teams[2].name} 第3:${gp.teams[2].third}%`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Qualifiers */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                { label: '小组第1 (12)', items: bracket?.groupWinners, color: 'text-emerald-600' },
                { label: '小组第2 (12)', items: bracket?.groupRunnersUp, color: 'text-sky-600' },
                { label: '小组第3出线 (8)', items: bracket?.qualifyingThirds, color: 'text-amber-600' },
              ].map(col => (
                <div key={col.label} className="bg-white rounded-lg border border-slate-200 p-3">
                  <div className={`${col.color} font-semibold mb-1.5`}>{col.label}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {col.items?.map((x: any) => (
                      <div key={x.name} className="truncate">{flag(x.name)} {x.name}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* BRACKET TREE: Classic tournament layout */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-x-auto">
              <div className="flex gap-2 items-start min-w-[1100px] text-[11px]">
                {/* Col-1: R32 left (→M101 upper) */}
                <div className="flex flex-col gap-1 w-[140px]">
                  <div className="text-[10px] font-bold text-sky-600 mb-1 px-1">⬆ 上半区 · 1/16决赛</div>
                  {upperLeft.map(id => <BracketSlotView key={id} id={id} r32={r32} opps={oppLookup[id]} />)}
                </div>
                <div className="flex flex-col gap-1 w-[140px] pt-5">
                  {upperRight.map(id => <BracketSlotView key={id} id={id} r32={r32} opps={oppLookup[id]} />)}
                </div>
                {/* R16 → M101 */}
                <div className="flex flex-col gap-1 w-[110px] pt-5">
                  <div className="text-[10px] text-slate-400 text-center mb-1">1/8决赛</div>
                  {['M89','M90','M91','M92'].map(id => <EmptyBox key={id} id={id} />)}
                </div>
                {/* QF → SF */}
                <div className="flex flex-col gap-1 w-[100px] pt-7">
                  <div className="text-[10px] text-slate-400 text-center mb-1">1/4决赛</div>
                  {['M97','M99'].map(id => <EmptyBox key={id} id={id} />)}
                </div>
                {/* SF → M101 */}
                <div className="flex flex-col justify-center w-[100px] pt-9">
                  <div className="text-[10px] text-slate-400 text-center mb-1">半决赛</div>
                  <div className="bg-sky-50 border border-sky-200 rounded-lg p-2.5 text-center">
                    <div className="font-mono text-[10px] text-sky-500">M101</div>
                  </div>
                </div>
                {/* FINAL center */}
                <div className="flex flex-col justify-center w-[110px] gap-4 pt-4">
                  {mc && (
                    <div className="bg-white border border-slate-100 rounded-lg p-2">
                      <div className="text-[10px] text-slate-400 mb-1">🏆 夺冠概率</div>
                      {mc.champion.slice(0, 5).map((t: any) => (
                        <div key={t.team} className="flex items-center gap-1 text-[10px]">
                          <span>{flag(t.team)}</span>
                          <span className="flex-1 truncate text-slate-600">{t.team}</span>
                          <span className="font-mono font-bold text-sky-600">{t.probability}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="bg-gradient-to-b from-yellow-100 to-yellow-50 border-2 border-yellow-400 rounded-xl p-3 text-center">
                    <div className="text-[10px] text-yellow-600 font-mono">M104</div>
                    <div className="text-sm font-bold text-yellow-700">🏆 决赛</div>
                    <div className="text-[10px] text-slate-400">7/19 纽约</div>
                  </div>
                </div>
                {/* SF → M102 */}
                <div className="flex flex-col justify-center w-[100px] pt-9">
                  <div className="text-[10px] text-slate-400 text-center mb-1">半决赛</div>
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-2.5 text-center">
                    <div className="font-mono text-[10px] text-rose-500">M102</div>
                  </div>
                </div>
                {/* QF → M102 */}
                <div className="flex flex-col gap-1 w-[100px] pt-7">
                  <div className="text-[10px] text-slate-400 text-center mb-1">1/4决赛</div>
                  {['M98','M100'].map(id => <EmptyBox key={id} id={id} />)}
                </div>
                {/* R16 → M102 */}
                <div className="flex flex-col gap-1 w-[110px] pt-5">
                  <div className="text-[10px] text-slate-400 text-center mb-1">1/8决赛</div>
                  {['M93','M94','M95','M96'].map(id => <EmptyBox key={id} id={id} />)}
                </div>
                {/* Col-8: R32 right (→M102 lower) */}
                <div className="flex flex-col gap-1 w-[140px] pt-5">
                  <div className="text-[10px] text-slate-400 text-center mb-1 opacity-0">.</div>
                  {lowerLeft.map(id => <BracketSlotView key={id} id={id} r32={r32} opps={oppLookup[id]} />)}
                </div>
                <div className="flex flex-col gap-1 w-[140px]">
                  <div className="text-[10px] font-bold text-rose-600 mb-1 px-1">⬇ 下半区 · 1/16决赛</div>
                  {lowerRight.map(id => <BracketSlotView key={id} id={id} r32={r32} opps={oppLookup[id]} />)}
                </div>
                {/* 3rd Place */}
                <div className="flex flex-col justify-end w-[90px] ml-1">
                  <div className="bg-slate-100 border border-slate-300 rounded-xl p-2 text-center">
                    <div className="text-[10px] text-slate-500 font-mono">M103</div>
                    <div className="text-xs font-semibold text-slate-600 mt-0.5">🥉 季军赛</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Accuracy Panel */}
            {accuracy && Object.keys(accuracy).length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-slate-600 mb-3">🎯 模型准确率对比（预测方向）</h3>
                <div className="space-y-2 text-xs">
                  {Object.entries(accuracy as Record<string,any>).map(([model, s]) => (
                    <div key={model} className="flex items-center gap-3">
                      <span className="w-12 text-slate-500">{model === 'mc' ? '📊 MC' : model === 'ds' ? '🧠 DS' : model === 'user' ? '👤 你' : model}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-4">
                        <div className={`h-4 rounded-full text-[10px] text-white text-right pr-1 leading-4 font-mono ${(s.direction/s.total*100) > 60 ? 'bg-emerald-500' : 'bg-sky-500'}`}
                          style={{width: `${Math.max(s.direction/s.total*100, 5)}%`}}>
                          {s.total > 0 ? `${Math.round(s.direction/s.total*100)}%` : ''}
                        </div>
                      </div>
                      <span className="text-slate-400 w-16 text-right">{s.direction}/{s.total} 场</span>
                      {s.exact > 0 && <span className="text-amber-500 text-[10px]">⭐{s.exact}场精确</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400">R32每队右侧数字 = Monte Carlo {mc?.totalSims || 10000}次模拟出线概率。绿=大概率出线(&gt;40%) 蓝=可能 灰=低概率</p>
          </div>
        )}
      </main>
    </div>
  );
}

function BracketSlotView({ id, r32, opps }: { id: string; r32: Record<string, any>; opps?: any[] }) {
  const s = r32[id];
  const getOppProb = (team: string | null) => {
    if (!team || !opps) return null;
    const found = opps.find((o: any) => o.team === team);
    return found?.prob || null;
  };
  const homeProb = getOppProb(s?.homeTeam);
  const awayProb = getOppProb(s?.awayTeam);

  return (
    <div className="bg-white border border-slate-200 rounded px-1.5 py-1">
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 truncate text-[11px]">
          <span className="text-[10px]">{flag(s?.homeTeam||'')}</span>
          <span className="truncate text-slate-700">{s?.homeTeam || s?.slot?.home || '待定'}</span>
        </span>
        {homeProb !== null && (
          <span className={`font-mono text-[10px] shrink-0 ${homeProb > 40 ? 'text-emerald-600 font-bold' : homeProb > 15 ? 'text-sky-600' : 'text-slate-400'}`}>
            {homeProb}%
          </span>
        )}
      </div>
      <div className="border-t border-slate-100 my-0.5"></div>
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 truncate text-[11px]">
          <span className="text-[10px]">{flag(s?.awayTeam||'')}</span>
          <span className="truncate text-slate-700">{s?.awayTeam || s?.slot?.away || '待定'}</span>
        </span>
        {awayProb !== null && (
          <span className={`font-mono text-[10px] shrink-0 ${awayProb > 40 ? 'text-emerald-600 font-bold' : awayProb > 15 ? 'text-sky-600' : 'text-slate-400'}`}>
            {awayProb}%
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyBox({ id }: { id: string }) {
  return (
    <div className="bg-slate-50 border border-dashed border-slate-200 rounded p-1.5 text-center text-slate-400 text-[10px]">
      {id}<br/>待定
    </div>
  );
}

function Spacer() { return <div className="h-6"></div>; }
