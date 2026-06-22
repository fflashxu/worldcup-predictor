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
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-sky-600 text-white text-center py-1 text-sm font-bold">{letter} 组</div>
      {teams.map((name, i) => {
        const s = standings?.find(t => t.name === name);
        return (
          <div key={name} className={`flex items-center gap-1 px-2 py-1 text-xs ${i < 2 ? 'bg-emerald-50/60' : i === 2 ? 'bg-amber-50/40' : ''}`}>
            <span className="w-3 text-slate-400 text-[10px]">{i + 1}</span>
            <span>{flag(name)}</span>
            <span className="flex-1 truncate">{name}</span>
            {s && <span className="text-slate-500 font-mono text-[10px]">{s.pts}分</span>}
          </div>
        );
      })}
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
    mutationFn: (d: { matchId: string; homeScore: number; awayScore: number }) => api.post('/predict', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['predictions'] }),
  });
  const triggerAI = useMutation({
    mutationFn: (matchId?: string) => api.post('/predict/ai', matchId ? { matchId } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['predictions'] }); setAiLoading(false); },
    onError: () => { setAiLoading(false); },
  });

  const getPred = (matchId: string, type: string) => preds?.find((p: Prediction) => p.matchId === matchId && p.predictedBy === type);

  const r32 = ((bracket?.bracket || []) as any[]).reduce((acc: any, s: any) => {
    acc[s.slot.matchId] = s; return acc;
  }, {});

  // R32 grouped by FIFA bracket zones (verified vs 央视/FIFA)
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
          <button onClick={() => { setAiLoading(true); triggerAI.mutate(); }} disabled={aiLoading}
            className="bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium">
            {aiLoading ? '🤖 预测中...' : '🤖 AI 预测'}
          </button>
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
                    {matches.map((m: any) => {
                      const userP = getPred(m.id, 'user');
                      const aiP = getPred(m.id, 'ai');
                      const [h, setH] = [userP?.homeScore ?? 0, userP?.awayScore ?? 0];
                      return (
                      <div key={m.id} className={`rounded-lg border p-2 text-xs ${
                        m.completed ? 'bg-emerald-50/30 border-emerald-200' : 'bg-white border-slate-200'
                      }`}>
                        <div className="text-[10px] text-slate-400 mb-1">{m.group} 组</div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate">{flag(m.home)} {m.home}</span>
                          <span className={`font-mono font-bold shrink-0 ${m.completed ? 'text-emerald-700' : 'text-slate-300'}`}>
                            {m.completed ? `${m.homeScore}-${m.awayScore}` : 'vs'}
                          </span>
                          <span className="truncate text-right">{flag(m.away)} {m.away}</span>
                        </div>
                        {(userP || aiP) && !m.completed && (
                          <div className="flex gap-2 mt-1.5 text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">
                            {userP && <span>👤 {userP.homeScore}-{userP.awayScore}</span>}
                            {aiP && <span>🤖 {aiP.homeScore}-{aiP.awayScore}</span>}
                          </div>
                        )}
                        {(userP || aiP) && m.completed && (
                          <div className="flex gap-2 mt-1.5 text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">
                            {userP && <span className={userP.homeScore === m.homeScore && userP.awayScore === m.awayScore ? 'text-emerald-600 font-bold' : 'text-rose-500'}>
                              👤 {userP.homeScore}-{userP.awayScore}</span>}
                            {aiP && <span className={aiP.homeScore === m.homeScore && aiP.awayScore === m.awayScore ? 'text-emerald-600 font-bold' : 'text-rose-500'}>
                              🤖 {aiP.homeScore}-{aiP.awayScore}</span>}
                          </div>
                        )}
                      </div>
                    )})}
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

                {/* R32 opponent probabilities */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-slate-600 mb-3">🎯 1/16决赛对手概率推演</h3>
                  <div className="grid grid-cols-4 gap-2 text-[11px]">
                    {mc.opponentProbs?.map((op: any) => (
                      <div key={op.matchId} className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                        <div className="font-mono text-sky-500 text-[10px] font-bold mb-1">{op.matchId} <span className="text-slate-400">({op.slot})</span></div>
                        <div className="space-y-0.5">
                          {op.opponents.slice(0, 4).map((o: any) => (
                            <div key={o.team} className="flex items-center gap-1">
                              <span className="text-[10px]">{flag(o.team)}</span>
                              <span className="flex-1 truncate text-slate-600">{o.team}</span>
                              <span className={`font-mono font-bold text-[10px] ${o.prob > 30 ? 'text-emerald-600' : o.prob > 10 ? 'text-sky-600' : 'text-slate-400'}`}>{o.prob}%</span>
                            </div>
                          ))}
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

            {/* BRACKET TREE */}
            <div className="overflow-x-auto">
              <div className="flex gap-1 items-start min-w-[1300px] text-xs">
                {/* LEFT SIDE → M101 semifinal */}
                <div className="flex flex-col gap-1 shrink-0">
                  <div className="text-[10px] text-sky-600 font-bold text-center mb-2 bg-sky-50 rounded py-1">⬆ 上半区</div>
                  {upperLeft.map(id => (
                    <R32Row key={id} id={id} slot1={(r32[id]?.slot?.home||'')} slot2={(r32[id]?.slot?.away||'')}
                      t1={r32[id]?.homeTeam||null} t2={r32[id]?.awayTeam||null} />
                  ))}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <div className="text-[10px] text-sky-600 font-bold text-center mb-2 bg-sky-50 rounded py-1 opacity-0">.</div>
                  {upperRight.map(id => (
                    <R32Row key={id} id={id} slot1={(r32[id]?.slot?.home||'')} slot2={(r32[id]?.slot?.away||'')}
                      t1={r32[id]?.homeTeam||null} t2={r32[id]?.awayTeam||null} />
                  ))}
                </div>
                {/* R16 */}
                <div className="flex flex-col gap-1 shrink-0 pt-5">
                  <div className="text-[10px] text-slate-400 text-center mb-1">1/8</div>
                  {['M89','M90','M91','M92'].map(id => (
                    <div key={id} className="bg-slate-50 border border-dashed border-slate-200 rounded p-1.5 text-center text-slate-400 text-[10px] min-w-[55px]">{id}<br/>待定</div>
                  ))}
                </div>
                {/* QF */}
                <div className="flex flex-col gap-1 shrink-0 pt-8">
                  <div className="text-[10px] text-slate-400 text-center mb-1">1/4</div>
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded p-2 text-center text-slate-400 text-[10px]">M97<br/>待定</div>
                  <Spacer /><Spacer />
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded p-2 text-center text-slate-400 text-[10px] mt-4">M99<br/>待定</div>
                </div>
                {/* M101 SF */}
                <div className="flex flex-col justify-center shrink-0 pt-10">
                  <div className="text-[10px] text-slate-400 text-center mb-1">半决赛</div>
                  <div className="bg-sky-50 border border-sky-200 rounded p-3 text-center">
                    <div className="font-mono text-[10px] text-sky-500">M101</div>
                  </div>
                </div>
                {/* FINAL */}
                <div className="flex flex-col justify-center shrink-0">
                  <div className="bg-gradient-to-b from-yellow-100 to-yellow-50 border-2 border-yellow-400 rounded-xl p-4 text-center shadow-sm min-w-[90px]">
                    <div className="text-[10px] text-yellow-600 font-mono">M104</div>
                    <div className="text-sm font-bold text-yellow-700 mt-1">🏆 决赛</div>
                    <div className="text-[10px] text-slate-400 mt-1">7/19 纽约</div>
                  </div>
                </div>
                {/* M102 SF */}
                <div className="flex flex-col justify-center shrink-0 pt-10">
                  <div className="text-[10px] text-slate-400 text-center mb-1">半决赛</div>
                  <div className="bg-rose-50 border border-rose-200 rounded p-3 text-center">
                    <div className="font-mono text-[10px] text-rose-500">M102</div>
                  </div>
                </div>
                {/* QF right */}
                <div className="flex flex-col gap-1 shrink-0 pt-8">
                  <div className="text-[10px] text-slate-400 text-center mb-1">1/4</div>
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded p-2 text-center text-slate-400 text-[10px]">M98<br/>待定</div>
                  <Spacer /><Spacer />
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded p-2 text-center text-slate-400 text-[10px] mt-4">M100<br/>待定</div>
                </div>
                {/* R16 right */}
                <div className="flex flex-col gap-1 shrink-0 pt-5">
                  <div className="text-[10px] text-slate-400 text-center mb-1">1/8</div>
                  {['M93','M94','M95','M96'].map(id => (
                    <div key={id} className="bg-slate-50 border border-dashed border-slate-200 rounded p-1.5 text-center text-slate-400 text-[10px] min-w-[55px]">{id}<br/>待定</div>
                  ))}
                </div>
                {/* R32 right */}
                <div className="flex flex-col gap-1 shrink-0">
                  <div className="text-[10px] text-rose-600 font-bold text-center mb-2 bg-rose-50 rounded py-1">⬇ 下半区</div>
                  {lowerLeft.map(id => (
                    <R32Row key={id} id={id} slot1={(r32[id]?.slot?.home||'')} slot2={(r32[id]?.slot?.away||'')}
                      t1={r32[id]?.homeTeam||null} t2={r32[id]?.awayTeam||null} />
                  ))}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <div className="text-[10px] text-rose-600 font-bold text-center mb-2 bg-rose-50 rounded py-1 opacity-0">.</div>
                  {lowerRight.map(id => (
                    <R32Row key={id} id={id} slot1={(r32[id]?.slot?.home||'')} slot2={(r32[id]?.slot?.away||'')}
                      t1={r32[id]?.homeTeam||null} t2={r32[id]?.awayTeam||null} />
                  ))}
                </div>
                {/* 3rd place */}
                <div className="flex flex-col justify-end shrink-0 ml-1">
                  <div className="bg-slate-100 border border-slate-300 rounded-xl p-3 text-center min-w-[70px]">
                    <div className="text-[10px] text-slate-500 font-mono">M103</div>
                    <div className="text-xs font-semibold text-slate-600 mt-1">🥉 季军赛</div>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400">⬆ 上半区 · ⬇ 下半区 · 1/16→1/8→1/4→半决赛→决赛 · 季军赛 · 基于 Annex C 规则实时推演</p>
          </div>
        )}
      </main>
    </div>
  );
}

function Spacer() { return <div className="h-6"></div>; }
