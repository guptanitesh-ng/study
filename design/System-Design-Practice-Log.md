# System Design Practice Log

Reviewed: November 20, 2026. Purpose: a tracking template for *deliberate practice*, not more content to read. The System-Design track (Design-Patterns-Principles -> Architecture -> Microservices-Toolkit -> System-Design) covers the vocabulary and worked examples; this file is where you log the actual talk-it-out-loud reps that turn that reading into interview-ready recall. See [System-Design-Index.md](System-Design-Index.md) for the "if asked about X, go to Y" lookup table.
## How to use this file

1. Pick one problem (rotate through § 5 of [System-Design-Notes.md](System-Design-Notes.md), then invent your own from systems you've actually run in production).
2. Run the 30-40 minute loop below **out loud** — silently re-reading notes does not train the skill the interview actually tests.
3. Fill in one row per rep. Keep entries terse; the point is the gap you log, not a polished write-up.
4. Review the "Gaps found" column every 2-3 days before your next rep — that list is your real flashcard deck, not the source notes.

### Spaced repetition cycle (why re-running a problem beats moving on)

Running a system-design rep once only proves you can talk through it *with the notes still fresh* — not that you'd drive the same design cold, out loud, in front of an interviewer weeks later. That cold recall is what actually gets tested. The cycle:

1. **First rep** — run the 30-40 minute loop, log the gap honestly (e.g., "didn't name a SPOF until the self-critique step").
2. **Don't move to a new problem immediately.** In 2-3 days, re-run the *same* problem (or a close variant, e.g. swap "design Twitter" for "design Instagram feed") completely cold — no notes, full loop, out loud.
3. **Judge the re-run, not the first rep.** If you proactively raise the trade-off and name the SPOF unprompted this time, the gap has closed. If you repeat the same miss, log it again and set another review date.
4. **Repeat until a gap survives a cold re-run**, then move to a new problem — trust it'll hold for the interview.

A single pass through every problem in § 5 feels like coverage, but the first few problems fade by the time you reach the last ones untested. Spaced re-running fewer problems, cold, builds the actual interview skill — talking fluently under pressure — rather than a false sense of "I've covered this."

## The 30-40 minute rep

| Step | Time | What to do |
|---|---|---|
| Clarify | 5 min | State assumptions, functional scope, and back-of-envelope scale (§ 3 cheat sheet) out loud. |
| High-level design | 15 min | Whiteboard/talk through the architecture end to end before drilling into any one box. |
| Deep dive | 10 min | Pick the one component most likely to draw a follow-up and go deep on it. |
| Self-critique | 5 min | Check against § 6's "interviewer follow-ups" — did you proactively raise the trade-off they'd ask about, and did you name a single point of failure unprompted? |

## Log

| Date | Problem | Key design decision I made | Gaps found (review these next) | Next review date |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

## Recurring gaps to watch for (seed this from real reps, don't pre-fill)

- Naming a mechanism (cache/shard/replica) before diagnosing *why* the store is overloaded.
- Jumping to a component deep-dive before finishing the end-to-end high-level pass.
- Not naming a single point of failure unprompted.
- Reaching for textbook jargon instead of citing a real production trade-off you've lived through.
