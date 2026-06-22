# ⚽ 2026 世界杯冠军预测

基于实时数据 + 双模型协同的 2026 美加墨世界杯赛果预测系统。

## 核心能力

- **实时赛程**：72 场小组赛完整赛程，实时比分同步（数据源：openligadb，锚定央视/体彩）
- **积分榜 & 出线概率**：12 组实时排名 + Monte Carlo 10000 次模拟出线概率
- **淘汰赛对阵推演**：R32 → 决赛完整对阵树，Annex C 规则自动落位
- **双模型预测**：
  - 📊 **Monte Carlo**：Bayesian Poisson 数学模型，独立 Poisson 采样，全局推演
  - 🧠 **DeepSeek**：LLM 推理 + 中国体彩赔率注入，三个风险偏好变体（保守/均衡/大胆）
- **个人预测**：每场 3 次预测机会，赛后自动对比准确率
- **冠军概率**：10000 次 Monte Carlo 模拟 → 夺冠概率柱状图

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite + Tailwind CSS + React Query |
| 后端 | Express + TypeScript + Prisma + SQLite |
| 数据 | openligadb.de + 中国体彩 webapi.sporttery.cn |
| AI | DeepSeek V4 Pro + Bayesian Poisson Monte Carlo |

## 双模型架构

```
📊 Monte Carlo                     🧠 DeepSeek
══════════════                     ═══════════
数据: 比赛结果                      数据: 比赛结果 + 体彩赔率
方法: Bayesian Poisson             方法: LLM 语义推理
产出: 3 独立 Poisson 样本            产出: 3 风险偏好预测
                                    V1 保守(跟赔率)
                                    V2 均衡
                                    V3 大胆(冷门)
```

两者完全独立，互补验证。

## 本地运行

```bash
git clone git@github.com:fflashxu/worldcup-predictor.git
cd worldcup-predictor

# 后端
cd backend && npm install && npx prisma migrate dev --name init && npm run dev

# 前端
cd frontend && npm install && npm run dev
```

访问 http://localhost:5400

## 数据更新

- 自动：每小时从 openligadb 同步赛果 → 积分榜 → Monte Carlo 重算
- 手动：点击页面 🔄 刷新数据 按钮

## License

MIT
