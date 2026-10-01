# AI Agents Strategy — Food2India

**Status:** v2.0 (rewritten after critique)
**Last updated:** 2026-05-18
**Scope:** Both `admin/` (ops cockpit) and `foodtoindia/` (customer app)

---

## 1. TL;DR

We started by proposing 15 AI agents. After validating against 30-day production data **and** business context, the answer is much smaller: **build 4 ops tools — only 1 of which uses an LLM.**

The "AI portfolio" framing was overengineered for current scale. At 47 orders/week, 14 reply-worthy emails/week, 4 campaigns ever sent, and a founder-led ops team, templates + scripts + the founder's judgment beat agents.

**What we're actually building (in order):**

1. **Manual WhatsApp button + recipient confirmation page** — ops tool, no AI. Attacks the #1 user-reported time-sink (recipient phone calls).
2. **Personalized cart recovery emails** — templates with variables, not AI. Attacks 60 abandoned carts/week with current 7% recovery.
3. **Dispatch monitoring cron** — script that alerts ops when an order is overdue. Prevents Mother's-Day-style failures.
4. **Inbox classification** — *this one uses an LLM.* Tags inbound emails by category. Drafting replies is not part of v1; classification of the ~43 unanswered emails/week is the real lift.

**Plus an R&D track:** Swiggy auto-ordering with restaurant-direct WhatsApp ordering as the more interesting fallback.

The other 11 ideas from v1 are deferred with explicit trigger conditions in §6 — they become useful when ops scales beyond the founder, but not before.

---

## 2. Why this changed from v1 (15 agents → 4 tools)

The v1 doc proposed a 15-agent portfolio. The data and business context don't support that scope:

- **Volume is small.** 47 orders/week, 14 reply-worthy inbound emails/week, 4 marketing campaigns ever sent. At this scale, an LLM-in-Slack (Claude in conversation with the founder) is already the agent layer. Formalizing it into deployed agents only earns its keep when there are operators who don't have direct access to Claude.
- **The personal founder touch is the product.** Nancy returned because the founder emailed her personally. A customer-facing concierge bot would have lost her. At founder-led companies the human-in-the-loop *is* the differentiation; automating it away is value-destroying.
- **Templates beat LLMs for deterministic personalization.** Cart recovery emails need recipient name, city, cart items — all already structured data. A template with variables produces the same result as an LLM for a fraction of the cost and complexity.
- **Cron beats agent for monitoring.** Dispatch anomaly detection is a deterministic SLA check. Wrapping it in "AI agent" framing adds nothing.

The v1 priority matrix is preserved in **Appendix A** for the audit trail.

---

## 3. Design principles

1. **Ops tools first; LLMs only where they earn it.** Reach for templates, cron, deterministic logic before AI. Use an LLM only when the input is unstructured or the judgment is genuinely subjective.
2. **The founder's personal touch is the product.** Don't automate away anything that customers value precisely *because* it's personal. Save founder time on internal ops work, not on customer relationships.
3. **Build for current volume, not hypothetical scale.** A 14-emails-per-week problem doesn't need infrastructure for 1000 emails per week. Re-evaluate when volume moves 5x.
4. **Founder-with-Claude is already the agent layer.** Until there are operators without access to Claude conversations, formalizing AI into deployed agents is premature.
5. **Defer with triggers, don't drop.** When deferring an idea, write down the volume / staffing / business condition that should make us revisit. Future-you will not remember.
6. **Manual before automated.** A manual button that opens WhatsApp wins over a full WhatsApp Business API integration for the first 6-12 months. Graduate when volume forces it.

---

## 4. The four tools

Each tool below is specified for build. Same format throughout.

### 4.1 Tool 1 — Manual WhatsApp Confirmation Button

**Problem:** Recipient phone calls are the #1 user-reported time-sink. 47 orders/week need recipient confirmation today.

**Solution:** A button in the admin dispatch queue that opens WhatsApp (via `wa.me/<phone>?text=<encoded>`) with a pre-formatted message to the recipient, including a link to a confirmation page. Recipient replies in WhatsApp or clicks through and confirms on the page. Confirmation state stored in Firestore.

**Why not the Twilio API version (yet):**
- 2-4 week WhatsApp Business API approval clock
- 4-6 weeks total engineering
- Template approval gate from Meta
- Per-message cost (~₹0.30-0.80)

vs. the manual version:
- 1-2 hours of engineering
- Zero approvals
- Zero per-message cost
- Captures ~80% of the value (ops still clicks once per order; the call is replaced by a chat)

**Architecture:**
- **Button** in `admin/pages/index.js` or wherever the dispatch queue lives: reads `recipient.recipientPhoneE164`, opens `wa.me/<E164>?text=<pre-formatted text>` in a new tab.
- **Pre-formatted message:** "Hi {recipientName}, this is Food2India confirming a delivery to you from {senderName}. Could you confirm your address: {address} and best delivery time? Tap here to confirm: {confirmationUrl}"
- **Confirmation page** in `foodtoindia/`: simple form with address (pre-filled), preferred time window, "Confirm" / "Update" / "Wrong person" buttons. Writes `recipient_confirmation: { status, address, time_window, confirmed_at }` to the order doc.
- **Dispatch queue** in admin: new column showing confirmation state (waiting / confirmed / updated / wrong-person).

**Graduate to API when:** sustained >100 orders/week OR ops headcount > 1 (so the manual click becomes shared work). At that point the WhatsApp Business API + Twilio investment pays back.

**Success metrics:**
- Time per order spent on recipient calls (target: -80%)
- % of orders with confirmed recipient state before dispatch
- Failed-delivery rate ("couldn't reach recipient")

---

### 4.2 Tool 2 — Personalized Cart Recovery Emails

**Problem:** 60 abandoned carts/week. Only 42 get reminders today and only 3 of those convert (7% post-reminder recovery). This is real money on the table.

**What's already built:** Cart recovery emails already personalize sender name, recipient name, restaurant name, cart items, and price. Subject lines rotate between recipient-specific ("A cart for [Recipient Name] is still waiting") and generic ("A cart you created is still waiting"). Reminders fire via a 30-min cron after cart creation.

**What to improve (no LLM needed):**

1. **Subject line A/B testing.** Add 4 rotating variants, randomly assigned:
   - "A cart for [Recipient Name] is still waiting"
   - "Your order for [Recipient Name] is ready to send"
   - "Complete your order for [Recipient Name]"
   Track open rates per variant in Resend analytics. Drop losers after 4 weeks.

2. **Add urgency line when applicable.** If the cart reminder is sent before 7pm IST, add: "Order before 9pm IST for same-day delivery." Tie to the same IST time check used in the checkout flow. Drop the line after 7pm IST - don't show it if it's not true.

3. **Add recipient city to the email body.** Currently shows recipient name and restaurant but not city. Adding "[Recipient Name] in [City]" reinforces the emotional connection ("your mom in Jalandhar") without being manipulative.

**Why templates beat AI here:**
- Inputs are deterministic: recipient name, city, items, restaurant, sender are all structured data already in Firestore
- An LLM would produce the same output as a templated email at 100x the cost
- Easier to A/B test (template variant A vs B beats LLM run A vs B for clarity)

**Reach for LLM only if:**
- Templated personalization plateaus below ~12% recovery rate
- Even then, prefer LLM-generated subject lines (where novelty matters most) over LLM-generated body copy

**Success metrics:**
- Recovery rate (target: 7% → 15%+)
- Revenue recovered per week
- Open rate per subject line variant
- Unsubscribe rate (watch for over-emailing)
---

### 4.3 Tool 3 — Dispatch Monitoring Cron

**Problem:** Mother's Day saw 6 overdue orders that the founder learned about from customer complaints (Nancy, Partha). A monitoring script would have alerted ops before customers had to.

**Solution:** Cron job every 15 minutes that scans the dispatch queue for orders past their SLA, alerts ops via Slack or WhatsApp.

**Why this is not an agent:**
- The check is deterministic ("order created > X hours ago AND status != 'dispatched'")
- The output is a simple alert
- No judgment required at detection time

**Architecture:**
- New file: `admin/scripts/dispatch-monitor.js` (or a Vercel cron route in `admin/pages/api/cron/dispatch-monitor.js`)
- Reads orders from Firestore where `status != 'dispatched'` and `createdAt` older than the SLA threshold
- Posts to a Slack webhook or sends a WhatsApp message via `wa.me` link with summary
- Runs every 15 minutes via Vercel cron

**Optional LLM enhancement (later):** Once the monitor is in place and trusted, optionally add a step that drafts a proactive customer apology + suggested store credit. **But only after the monitor has run cleanly for a month** — earning the right to compose customer-facing language is downstream of earning the right to detect anomalies.

**Success metrics:**
- Mean-time-to-detect overdue order (target: <15 min)
- # of customer complaints about late delivery that beat the alert to ops (target: 0)
- False positive rate (alerts that turn out to be normal pending state)

---

### 4.4 Tool 4 — Inbox Classification (the one LLM use case)

**Problem:** 57 inbound emails/month, only 14 get replies. The other 43 are some mix of refund requests, delivery complaints, menu questions, spam, and cancellations. Ops needs to know which deserve attention.

**Solution:** LLM classifies each inbound email into one of N categories at receipt time, tags the email in Firestore, displays the tag in the admin inbox view.

**Why an LLM here and nowhere else:**
- Input is unstructured natural language
- Categories are subjective enough that rules-based classification will miss the long tail
- 57 emails/month is enough volume to justify the LLM call, low enough that cost is trivial

**Why NOT draft replies (yet):**
- At 14 reply-worthy/week, the founder writes a reply faster than reviewing an LLM draft
- Drafts add review-burden without removing decision-burden
- Reach for drafts when reply volume is ~30+/week sustained

**Architecture:**
- New inbound-email webhook handler runs an LLM classification (Claude Haiku — cheap, fast) with categories: `refund-request`, `delivery-issue`, `menu-question`, `cancellation`, `gift-question`, `complaint`, `spam`, `other`
- Stores tag on the `inbound-emails/{id}` doc as `category` + `category_confidence`
- Admin `/inbox` page displays category badge next to each email
- Filter / sort by category in the admin UI

**Success metrics:**
- Classification accuracy (sample 20 emails/week against human labels)
- Time-to-first-touch on refund-requests and complaints (target: <4h)
- # of unanswered-but-important emails surfaced

---

## 5. R&D track — Swiggy auto-ordering + restaurant-direct alternative

This is the *other* user-reported big time-sink (along with recipient calls). Not measurable in Firestore. Runs in parallel with the 4 tools, **not** in their critical path.

**Two parallel investigations:**

### 5.1 Swiggy / Zomato browser automation (the original plan)

- Week-1 prototype: can Playwright maintain a stable Swiggy session for 7 days without bot detection?
- Architecture as documented in v1.2: state machine (`IDLE → SEARCHING → CART_BUILT → CHECKOUT → AWAITING_OTP → COMPLETING → DONE | FAILED`)
- OTP handoff: pauses at `AWAITING_OTP`, posts to Slack / WhatsApp with order context + last-4-of-card, resumes on ops reply
- Account-ban risk, TOS-grey, residential proxy required

### 5.2 Restaurant-direct WhatsApp ordering (the more interesting alternative)

If the founder regularly orders from the same top 5-10 restaurants in Jalandhar (and similar pockets), **skip the aggregator entirely.** Order via WhatsApp directly with the restaurant.

- Zero platform dependency
- Zero bot risk
- Lower margin saved (no Swiggy markup) but probably better food / fewer cancellations
- Could be partially automated: a button in admin that opens WhatsApp to the restaurant with the order summary pre-formatted

**Decision logic:**
- If Week-1 Swiggy prototype proves stable → build full Swiggy agent
- If Week-1 prototype is fragile → pivot fully to restaurant-direct for top-5
- If volumes per restaurant justify it → build restaurant-direct *first*, treat Swiggy as overflow

---

## 6. Deferred — with trigger conditions

Each idea from v1 that didn't make the cut is recorded here with the condition under which it should be revisited.

| Idea (from v1) | Why deferred | Revisit when |
|----------------|-------------|--------------|
| **Customer-facing Order Concierge** | 14 emails/week + founder personal touch IS the product. Nancy returned because of personal email, a bot would have lost her. | Inbox sustained >50 emails/week AND ops can't keep up |
| **Feedback Synthesizer** | Founder reads 57 emails/month in 30 min. Synthesis happens in-conversation with Claude already. | Ops team grows beyond founder, OR inbox > 200 emails/month |
| **Refund / Credit Drafter** | 7 cancellations/month is manual-able. Partha-style situations needed founder judgment, not AI recommendation. | >30 refunds/month sustained |
| **Cohort / Retention Watcher** | Existing script (`top-customer-concentration.js`) is the right artifact. "AI narrative wrapper" adds nothing. | Founder stops running the script monthly AND wants automated narrative |
| **Returning-Customer Recommender** | Only 2% of users reorder exact same items (prior analysis). Customers want same recipient, different food. Existing "reorder for {Name}" button is the right UI. | Reorder-pattern data changes meaningfully |
| **Audience Curator (Resend)** | 4 campaigns ever sent via Resend dashboard directly. Cadence ~1 every 6-8 weeks. | Marketing cadence >1 campaign/month sustained |
| **Campaign Copy Drafter** | Campaigns are drafted in-conversation with Claude today, working well. | Marketing cadence >1 campaign/month AND founder wants templated workflow |
| **Send-Time Optimizer** | 4 campaigns ever — insufficient per-recipient data to optimize anything. | After >20 campaigns sent (i.e., 2+ years at current cadence) |
| **Fraud / Anomaly Sentinel** | 7 cancellations/month, no observed fraud pattern. Existing Stripe risk score is enough. | First chargeback >$500 OR a clear fraud pattern emerges |
| **Store Credit Auditor** | 3 credits ever issued, $66 total. Nothing to audit. | >50 credits issued |
| **AI-generated dispatch apology copy** (on top of Tool 3) | Detect first, draft later. | Tool 3 has run cleanly for 1 month AND apology drafting becomes the bottleneck |

---

## 7. Production volume baseline (measured 2026-05-18)

Source of truth for every "is this worth building" judgment in this doc. Raw data in `docs/agent-impact-data.json`. Re-run via:

```
NODE_OPTIONS='--openssl-legacy-provider' FIREBASE_ENV=production \
  node scripts/measure-agent-impact.js
```

| Workflow | Volume (30d) | Per week | Note |
|----------|-------------|----------|------|
| Orders placed | 201 | 47 | 1196 total users in system |
| Orders dispatched | 178 | 41 | 96% completion rate |
| Orders cancelled | 7 | 1.6 | Low base rate |
| Inbox emails received | 57 | 13 | ~75% don't get a reply |
| Inbox emails replied | 14 | 3 | Reply volume is modest |
| Abandoned carts | 255 | 60 | Highest-volume customer touchpoint |
| Cart reminders sent | 42 | 10 | Only 16% of abandoned carts get reminders |
| Carts converted after reminder | 3 | <1 | 7% recovery rate — clear improvement headroom |
| Store credits issued (all-time) | 3 | — | $66 total |
| Email campaigns (in `email-campaigns` collection) | 0 | 0 | 4 campaigns ever sent via Resend dashboard directly |
| Orders with recipient phone captured | **201 / 201 (100%)** | 47 | `recipient.recipientPhoneE164` |

Re-measure quarterly. When any of these volumes shift 3x+, revisit the deferred-table triggers.

---

## 8. Build order and timing

| When | Build | Notes |
|------|-------|-------|
| **Week 1** | Tool 1 (manual WhatsApp button + confirmation page) | Highest user-stated pain. Manual version ships fast. |
| **Week 1** (parallel) | Tool 2 (personalized cart recovery template) | Independent track; no dependencies. |
| **Week 2** | Tool 3 (dispatch monitoring cron) | Lightweight script. |
| **Week 3** | Tool 4 (inbox classification) | The one LLM use case. |
| **Week 2 onward (parallel R&D)** | Swiggy R&D + restaurant-direct prototype | Go / no-go gate at end of week 2 of R&D. |

Total: 3-4 weeks to ship all 4 tools, with R&D running in the background.

---

## 9. What we explicitly chose NOT to build (and why)

To avoid scope creep, the following are out of scope for v2.0:

- **An "agent platform" / "agent runtime"** — premature; we have 1 LLM use case
- **Voice rubric + LLM-as-judge eval framework** — needed only if we add LLM-drafted customer-facing copy (we're not)
- **Customer-facing chat widgets** — see §6 (founder touch is the product)
- **Auto-decisioning on refunds, fraud, credits** — manual judgment beats AI judgment at this scale
- **Multi-agent orchestration / event bus** — overengineering for 4 independent tools
- **Resend API integration for marketing** — defer until cadence justifies it

---

## 10. Open questions

1. **WhatsApp message template language** — Tool 1's pre-formatted message: English only, or include Hindi / Punjabi for regional recipients? Founder to provide template text.
2. **Dispatch SLA threshold** — Tool 3 needs an explicit "X hours late = alert." Founder to pick the number based on the Mother's Day incident's pattern.
3. **Inbox classification categories** — the suggested list in §4.4 is reasonable but founder should validate; possibly add "translation request" or "international recipient" as their own buckets.
4. **Restaurant-direct WhatsApp ordering** — which 5 restaurants would this be tried with first? Need founder input on top-volume vendors with WhatsApp-friendly owners.

---

## Appendix A: v1.2 priority matrix (archived for audit trail)

The original 15-agent analysis. Preserved here so the chain of reasoning from "15 agents" to "4 tools" is auditable.

Scoring axes:
- **Impact** — measured pain over 30-day prod window
- **ROI** — qualitative value-per-action if shipped
- **Build** — engineering complexity (10 = easy)
- **Approvals** — external dependencies (10 = none)
- **Risk** — blast radius (10 = safe)

| # (v1.2) | Agent | Stakeholder | Impact | ROI | Build | Appr | Risk | v2.0 disposition |
|---|-------|------------|--------|-----|-------|------|------|-----------------|
| 1 | Recipient WhatsApp Confirmation | Ops + Recipients | 10 | 10 | 5 | 3 | 8 | **Built as Tool 1** (manual version, not API) |
| 2 | Abandoned-Cart Personalizer | Customers + Marketing | 9 | 7 | 7 | 10 | 8 | **Built as Tool 2** (templates, not LLM) |
| 3 | Inbox Triage + Reply Drafter | Ops | 6 | 9 | 8 | 10 | 9 | **Built as Tool 4** (classification only, drafts deferred) |
| 4 | Swiggy / Zomato Auto-Ordering | Ops | 9 | 10 | 2 | 2 | 3 | R&D track + restaurant-direct alternative |
| 5 | Dispatch Anomaly Watcher | Ops + Customers | 4 | 7 | 7 | 10 | 8 | **Built as Tool 3** (cron, not agent) |
| 6 | Feedback Synthesizer | Product | 5 | 6 | 9 | 10 | 10 | Deferred |
| 7 | Refund / Credit Drafter | Ops + Finance | 3 | 7 | 8 | 10 | 9 | Deferred |
| 8 | Cohort / Retention Watcher | Product + Finance | 5 | 5 | 9 | 10 | 10 | Deferred (script already exists) |
| 9 | Returning-Customer Recommender | Customers | 5 | 5 | 6 | 10 | 8 | Deferred (2% same-item reorder rate) |
| 10 | Customer-Facing Order Concierge | Customers | 4 | 8 | 4 | 9 | 5 | Deferred (founder touch is the product) |
| 11 | Fraud / Anomaly Sentinel | Finance + Ops | 3 | 6 | 7 | 10 | 8 | Deferred |
| 12 | Audience Curator (Resend) | Marketing | 3 | 7 | 7 | 10 | 9 | Deferred |
| 13 | Campaign Copy Drafter | Marketing | 3 | 6 | 7 | 10 | 7 | Deferred (founder + Claude is the drafter) |
| 14 | Send-Time Optimizer | Marketing | 2 | 4 | 6 | 10 | 9 | Deferred |
| 15 | Store Credit Auditor | Finance | 1 | 4 | 9 | 10 | 10 | Deferred (3 credits ever) |

---

## Appendix B: Glossary

- **Manual WhatsApp button** — `wa.me/<phone>?text=<message>` link in admin UI that opens WhatsApp Web / mobile with a pre-formatted message. Zero infrastructure.
- **WhatsApp Business API** — Twilio / 360dialog / MessageBird's programmatic WhatsApp send, requires Meta template approval. Deferred until volume justifies it.
- **Founder-with-Claude as the agent layer** — the pattern where the founder uses Claude conversationally to draft emails, synthesize feedback, write campaigns, etc. At small scale this beats deploying formal agents.

---

## Changelog

- **2026-05-18 (v2.0)** — Rewritten after critique from an LLM with broader business context. Key shifts:
  - Frame changed from "15 AI agents" to "4 ops tools, 1 of which uses an LLM"
  - **Tool 1: manual WhatsApp button** instead of Twilio API (saves 4-6 weeks for 80% of value)
  - **Tool 2: personalized templates** instead of LLM-generated copy
  - **Tool 3: cron monitor** instead of "anomaly watcher agent"
  - **Tool 4: classification only** instead of full triage + draft
  - 11 v1 ideas deferred with explicit trigger conditions
  - Added founder-touch-as-product as a design principle
  - v1.2 priority matrix archived in Appendix A
- **2026-05-18 (v1.2)** — Corrected two measurement errors (recipient phone captured at 100%, campaigns sent via Resend direct). Re-ranked.
- **2026-05-18 (v1.1)** — Added measured prod volumes and re-ranked.
- **2026-05-18 (v1)** — Initial draft. 15 agents catalogued.
