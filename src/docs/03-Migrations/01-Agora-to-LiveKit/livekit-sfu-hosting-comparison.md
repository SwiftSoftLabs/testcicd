# LiveKit SFU hosting: VPS vs LiveKit Cloud

Research summary for choosing where OneWork runs **realtime video/audio** after the Agora → LiveKit migration. Complements [livekit-prod-setup.md](./livekit-prod-setup.md) (Oracle self-host runbook) and [agora-to-livekit.md](./agora-to-livekit.md) (full migration research).

**App context:** OneWork (`app_onework`), Vercel (app + APIs), InsForge (DB + recordings). This doc covers only the **media layer** (SFU).

---

## What is an SFU, and why does it matter?

**SFU** stands for **Selective Forwarding Unit**. It is a dedicated realtime media server that sits between call participants in a **group video call**.

### How it works (simplified)

```
Participant A ──upload video/audio──► SFU ──forward streams──► Participant B, C, D
Participant B ──upload────────────────► SFU ──forward──────────► A, C, D
```

- Each person **sends one stream** to the SFU.
- The SFU **forwards** the right streams to everyone else (it does not mix everyone into one stream like old “MCU” bridges).
- When someone’s network is poor, the SFU can drop layers (simulcast) so the call stays usable.

### Why OneWork needs an SFU

| Need | Without SFU | With SFU (LiveKit) |
|------|-------------|-------------------|
| **3+ people in one call** | Pure peer-to-peer scales badly (N×N connections) | One upload per person; server forwards |
| **NAT / firewalls** | Many users cannot connect directly | TURN relay through the media platform |
| **Screen share + camera** | Hard to coordinate in P2P | Standard track model (what `LiveKitCallRoom` uses) |
| **Consistent UX** | Depends on each client’s network | Central place to manage rooms, limits, reconnect |

**What is *not* an SFU:** Vercel, InsForge, Firebase, or AWS Lambda. They handle HTTP, data, and auth — not continuous WebRTC media (UDP/TCP streams for minutes per call).

In OneWork:

- **Vercel** — UI, `POST /api/calls/[id]/token` (JWT), Gemini webhooks.
- **InsForge** — `call_sessions`, participants, recording storage.
- **LiveKit** — the SFU; browsers connect with `room.connect(url, token)` after getting a token from Vercel.

Choosing where LiveKit runs (Cloud vs VPS) is choosing **who operates the SFU** and **what you pay at scale**.

---

## Assumptions for the tables below

- **Participant-minute** = people in the call × minutes. Example: 4 people × 30 minutes = **120** participant-minutes.
- **Concurrent participants** = everyone in active video calls at the same instant (not registered users or workspace members).
- Capacity figures are **practical estimates** for typical OneWork calls (mostly 2–10 people, video on, occasional screen share). They are not LiveKit load-test guarantees.
- **Whisper live captions** (`services/livekit-agent`) are CPU-heavy; running the agent on the **same** box as the SFU reduces how many concurrent calls the box can handle.

**Pricing sources (captured 2026):** [LiveKit Cloud pricing](https://livekit.io/pricing), [Hetzner Cloud](https://www.hetzner.com/cloud), [DigitalOcean Droplets](https://www.digitalocean.com/pricing/droplets). VPS prices vary by region and VAT.

---

## VPS specifications vs capacity

| Tier | Example VPS | ~$/mo | SFU only (concurrent participants) | SFU + Whisper agent (same box) | Best for OneWork |
|------|-------------|-------|-------------------------------------|--------------------------------|------------------|
| **Dev** | `livekit-server --dev` (local) | $0 | Few | 1 call | Local development only |
| **Minimal free** | Oracle A1 **2 OCPU / 12 GB** | **$0** | ~15–30 | **1–2** caption calls | Early prod, very small team ([runbook](./livekit-prod-setup.md)) |
| **Minimal paid** | Hetzner **CAX11** (2 ARM / 4 GB) | ~$5 | ~10–20 | Not recommended (RAM) | SFU-only micro |
| **Recommended starter** | Hetzner **CAX21** (4 ARM / 8 GB) | ~$9 | ~40–60 | ~3–5 caption calls | **Best cheap paid prod** |
| **Starter x86** | Hetzner **CX33** (4 vCPU / 8 GB) | ~$7 | ~40–60 | ~3–5 caption calls | Same if not on ARM |
| **Growth (single box)** | Hetzner **CAX31** (8 ARM / 16 GB) | ~$18 | ~80–120 | ~5–8 caption calls | Busier small prod |
| **Growth (split)** | **CAX21** SFU + **CAX21** agent | ~$18 | ~50–60 on SFU | ~5–8 caption calls | **When captions matter** |
| **Medium self-host** | **CX43** (8 / 16 GB) or 2× CAX31 | ~$26–35 | ~100–150 | Split agent required | Many concurrent rooms |
| **US-friendly** | DO Basic **4 GB / 2 vCPU** | **$24** | ~30–50 | ~2–3 caption calls | Simpler US region, higher $ |
| **US growth** | DO Basic **8 GB / 4 vCPU** | **$48** | ~60–90 | ~4–6 caption calls | US + managed feel |
| **AWS (reference)** | **t4g.large** (2 Graviton / 8 GB) | ~**$60** | ~50–80 | ~4–6 caption calls | Compliance / existing AWS |

### Sizing notes

- LiveKit’s production guidance suggests **at least ~4 CPU cores** per SFU node; 2-core boxes are fine for demos, tight for growth.
- **Split early:** SFU on one VPS, Python agent on another, once more than a few simultaneous caption calls are expected.
- **Scale out:** multiple LiveKit nodes + **Redis** (already in `services/livekit/docker-compose.prod.yml`), not one infinitely large VM.

---

## LiveKit Cloud Build vs self-hosted VPS

| | **LiveKit Cloud Build** | **Hetzner CAX21 (~$9)** | **Oracle 2 OCPU / 12 GB ($0)** |
|--|-------------------------|-------------------------|--------------------------------|
| **Monthly base** | **$0** | ~$9 | **$0** |
| **WebRTC included** | **5,000** participant-min/mo | Limited by hardware | Limited by hardware |
| **Agent minutes included** | **1,000** / mo (Cloud Agents) | Limited by CPU (self-host agent) | Same |
| **Max concurrent connections** | **100** | ~40–60 participants (SFU) | ~15–30 |
| **TURN / TLS / UDP** | Managed | You (Caddy + firewall) | You |
| **Regions** | Global edge | One region (e.g. EU) | One region |
| **Operations** | None | Patch, monitor, backup VM | Same + account/signup friction |
| **OneWork code changes** | Env vars only | None (current LiveKit PR) | None |
| **Good fit** | Fastest path, no VM | Best $/performance self-host | If Oracle account works |

---

## Scaling: monthly video cost vs usage

LiveKit Cloud **WebRTC** allowances and overage ([pricing](https://livekit.io/pricing)):

| Plan | Monthly fee | WebRTC participant-min included | Overage (video) |
|------|-------------|----------------------------------|-----------------|
| **Build** | $0 | 5,000 | No pay-as-you-go — upgrade to Ship |
| **Ship** | $50 | 150,000 | **$0.0005** / participant-min |
| **Scale** | $500 | 1,500,000 | **$0.0004** / participant-min |

### Estimated monthly cost (video / SFU only)

| Monthly usage (participant-min) | Example workload | **Build ($0)** | **Ship ($50)** | **Scale ($500)** | **Self-host (~$9–18 VPS)** |
|----------------------------------|------------------|----------------|----------------|------------------|----------------------------|
| **3,000** | Small team | **$0** | $50 | $500 | ~$9 |
| **5,000** | At Build cap | **$0** | $50 | $500 | ~$9 |
| **20,000** | Regular daily calls | Upgrade needed | **$50** | $500 | **~$9–18** |
| **150,000** | Active product | — | **$50** | $500 | **~$18–35** |
| **200,000** | Growing | — | ~**$75** ($50 + 50k overage) | $500 | ~$18–35 (+ maybe 2nd node) |
| **500,000** | Busy SaaS | — | ~**$225** | $500 | ~$35–70 (2–3 nodes) |
| **1,500,000** | High volume | — | ~**$725** | **$500** | ~$70–150 + ops time |

**Effective cost per 1M participant-minutes (video only, rough)**

| Approach | ~$/1M participant-minutes |
|----------|---------------------------|
| **Build** (≤5k/mo) | **$0** |
| **Ship** (fully using 150k bundle) | ~**$333** |
| **Ship** at 500k total usage | ~**$450** |
| **Scale** (fully using 1.5M bundle) | ~**$333** |
| **Self-host** (~$18/mo, &lt;150k min, one box enough) | ~**$120** infra only |
| **Self-host** at ~1.5M min (multi-node) | ~**$50–150** infra + engineering |

Cloud buys **managed TURN, global edge, and no port wrangling**. Self-host wins on **raw $** at steady medium-high volume if the team can operate VMs.

---

## Agent / live captions cost (LiveKit Cloud)

If captions run as **LiveKit Cloud Agents** (hosted workers), agent session minutes are billed separately from WebRTC minutes. Overage is **$0.01 / agent-minute** on Ship and Scale ([pricing](https://livekit.io/pricing)).

| Monthly agent minutes | **Build** | **Ship ($50)** | **Scale ($500)** |
|----------------------|-----------|----------------|------------------|
| **500** | $0 | $50 plan | $500 |
| **1,000** | $0 (cap) | $50 | $500 |
| **5,000** | Upgrade needed | **$50** (included) | $500 |
| **10,000** | — | ~**$100** ($50 + 5k overage) | $500 |
| **50,000** | — | ~**$500** | **$500** (included) |

**Self-hosted Whisper** (`services/livekit-agent`) has **no per-minute cloud fee** — you pay VPS CPU/RAM instead. A common pattern: **LiveKit Cloud SFU + self-hosted agent on a $9 VPS**, or **split SFU and agent across two small VPSs** when both are self-hosted.

For which Whisper model we ship to prod, how STT differs from Gemini (LLM), and the full data flow, see [livekit-stt-llm-pipeline.md](./livekit-stt-llm-pipeline.md).

---

## What breaks first as usage grows

| Signal | Build / small VPS | Action |
|--------|-------------------|--------|
| **>5k video participant-min/mo** | Build quota exhausted | Move to **Ship** or **~$9 VPS** |
| **>10 concurrent video calls** | Single small VPS stressed | Split agent; upgrade to **CAX31** or second node |
| **>100 concurrent connections** | Build hard limit (100) | **Ship** (1,000) or multi-node self-host |
| **Captions on many simultaneous calls** | Whisper CPU saturated | **Dedicated agent VPS** or disable live captions under load |
| **>150k video min/mo** | Ship overages accumulate | Compare **Scale ($500)** vs **multi-VPS self-host** |
| **HIPAA / SOC2 / region pinning** | — | **Scale** tier minimum for several compliance features |

---

## What does *not* replace the SFU

| Service | Role in OneWork | Handles group video? |
|---------|-----------------|----------------------|
| **Vercel** | Next.js, tokens, Gemini APIs | No |
| **InsForge** | Postgres, storage, realtime events | No |
| **Firebase** | Not used today; no native SFU product | No |
| **AWS Lambda / API Gateway** | Could mint tokens; cannot host media | No |
| **Amazon Chime SDK** | Managed WebRTC (different SDK) | Yes, but **full client rewrite** |

---

## Decision matrix (recommended)

| Stage | Recommendation |
|-------|----------------|
| **Launch, &lt;5k participant-min/mo, avoid VMs** | **LiveKit Cloud Build** — set `LIVEKIT_URL` / `NEXT_PUBLIC_LIVEKIT_URL` to Cloud project |
| **Launch, OK with ~$9/mo, want control** | **Hetzner CAX21** — same stack as [livekit-prod-setup.md](./livekit-prod-setup.md), different provider |
| **Oracle account works, tiny traffic** | **Oracle Always Free** — $0, same compose; harder signup |
| **~20k–150k participant-min/mo** | **Ship ($50)** *or* **self-host ~$9–18** (self-host often cheaper in dollars) |
| **~150k–1.5M participant-min/mo** | **Scale ($500)** *or* **2–4 VPS nodes (~$35–70+)** |
| **Live captions always on** | **SFU (Cloud or VPS) + agent on separate VPS** |

### Locked architecture (unchanged)

```
Browser ──WebRTC──► LiveKit SFU (Cloud or VPS)
Browser ──HTTPS──► Vercel (UI, token, Gemini)
Browser / APIs ──► InsForge (app_onework)
Agent worker ──WSS──► LiveKit + HTTP ──► Vercel (LLM webhook)
```

---

## Summary

- An **SFU** is the realtime media server that makes **multi-party in-app video** workable; OneWork’s SFU is **LiveKit**.
- **Vercel and InsForge stay as they are**; only the SFU hosting choice (and optionally agent hosting) drives cost and ops.
- **Free to start:** LiveKit Cloud **Build** (5k participant-min/mo) or local/`--dev` for development.
- **Best value self-host:** ~**$9/mo** VPS with **4 vCPU / 8 GB** (e.g. Hetzner CAX21).
- **At scale:** compare **Ship/Scale** overages to **multi-node self-host**; split the **Whisper agent** off the SFU box before CPU becomes the bottleneck.

---

## Related docs

| Document | Use when |
|----------|----------|
| [livekit-prod-setup.md](./livekit-prod-setup.md) | Deploying self-hosted LiveKit on Oracle VM |
| [agora-to-livekit.md](./agora-to-livekit.md) | Full migration design and feature parity |
| [../current-feature.md](../current-feature.md) | Active feature status and decisions |
| [services/livekit/README.md](../../../services/livekit/README.md) | Local `livekit-server --dev` quickstart |
| [services/livekit-agent/README.md](../../../services/livekit-agent/README.md) | Python agent + Whisper captions |
