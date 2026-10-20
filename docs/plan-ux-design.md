# Why the planning panel looks the way it does

Plan mode ("Try an idea") is meant to be used by university professors and officers, often aged 45 to 70, who are at ease with email and documents but not with tools that have many options. This page records what that asks of the design, what was built, and what is still unproven.

## What the first version got wrong for this audience

The first Sandbox was built like a GIS tool: five tabs (Design, Simulate, Budget, Types, Report), 20-odd tools in a grid, a Run button, tables of verdicts, and words such as *scenario*, *catchment*, *kWp*, *lux*, *dBm*, *GFA*. An audit of it (see "How it was checked" below) found the same few problems again and again:

- No starting point. Someone who did not know what to try had nothing to click that would show them.
- Tools stayed switched on after one placement, so the next click on the map silently added another item.
- Results were tables of numbers with a tick or a cross; colour carried meaning on its own (red and green Wi-Fi map), and the numbers had no sentence to say what they meant.
- Mistakes were met with "are you sure?" dialogs, or silently stuck.
- Small text (11 to 13 px), grey on grey secondary text below 4.5:1 contrast, and 24 to 32 px click targets.
- Panel state was lost on the way: changing a field rebuilt the whole card and dropped the cursor.

## The design

**A path, not a toolbox.** Four steps stay on screen at all times: **1 Goal, 2 Changes, 3 Results, 4 Share**. Any step can be clicked at any time; the path is a suggestion, not a gate. Step 1 asks one question, *what would you like to improve?*, with six answers in words people use (Wi-Fi in hostels, street lighting, cycle sharing, water, solar and trees, bins and drinking water, a new building) and ready-made examples. The answer puts that goal's tools first and offers a one-click quick start. Everything else is still there, one fold-out away.

**The result is a sentence.** *"With your Wi-Fi points, 96% of the floor area in the 16 buildings checked gets a signal good enough for a video call, up from 0% today."* Each card has a status in words and a symbol (✓ Target met, ◐ Almost there, ✕ Not there yet), never colour alone, and a gauge showing today, the target and the plan. A strip under the steps keeps the headline result, the cost and the targets met in view while you work. The full tables, maps and cost lines are still there, under *Show the numbers and the maps* and *Cost, line by line*.

**One placement, then done.** Choosing a tool, clicking the map once, places one thing and switches the tool off. *Keep adding* is a tick box for people who want several. For people who cannot or would rather not click on the map, a cross marks the middle of the screen and `Enter` or `Space` acts there.

**Undo instead of "are you sure".** Every change says what it did and offers **Undo** in the message, which stays long enough to read and pauses while the pointer or focus is on it. The only dialog left asks before deleting a whole saved plan, which cannot be undone.

**Words.** *Scenario* became *plan*; *Simulate* became *Results*; *Goal* is kept for the first question only (what would you like to improve?) and the percentages to reach are *targets*; the tools have names a person would say (*Cycle stand*, *Bins (wet + dry)*, *Light a whole road*). Jargon that has to stay (dBm, lux, IS 1944, kWp) is explained in the Help word list and in the sentence that uses it.

**Reading comfort and control.** Base text is 16 px; targets are 44 px or more; secondary text and every status colour meet WCAG 2.2 AA contrast in light and dark themes; focus is a 3 px ring; there is a text size control (up to 22 px), a stronger-contrast option, a less-movement option (also honouring the system setting) and a switch for the single-letter shortcuts (`W A S D Q E P V R`), since single-key shortcuts get in the way of dictation and switch devices (WCAG 2.1.4). The Wi-Fi signal map uses a colour-blind-safe palette with the words Weak, Usable, Good, Strong under it. The panel is a bottom sheet on a phone and shrinks to a strip while you place something.

**Honesty about accuracy.** Each results page ends with *What these numbers do not tell you* (the Wi-Fi model is not a survey, lights are the ones you place, people are estimated from floor area, costs are indicative 2026 rates), and Help has a plain explanation. A building drawn from far above can be far too big; the card says so in football pitches.

**Moving the map like a map.** In planning, dragging moves the map and right-drag (or Shift-drag) turns it. `W A S D` and the arrow keys fly in every view.

## How it is built

`campus/js/plan.js` keeps the logic (map, tools, Rust/WASM engine, plans, files, report) and speaks to the rest of the page through `window.__sandbox.api` and `sandbox:*` events. `campus/js/plan-guide.js` is the shell: steps, goal screen, result sentences, messages, help, tour and display settings. The markup and styles are in `campus/index.html`. The classic viewer bundles to a single file by inlining plain `<script src>` tags, so both are plain scripts with no build step.

## How it was checked

- A design pass and a separate audit of the previous UI set the targets above.
- The new UI was driven on a real GPU (Brave, Windows) through the DevTools protocol: first-run journey, quick start, placing and undoing, *Keep adding*, drawing a building, keyboard placement at the cross, results and share, help, tour, display settings, dark theme, stronger contrast, 1366 × 768 and a 390 px phone (`tools/dev/plan1.mjs` to `plan5.mjs`).
- A contrast audit (`tools/dev/plan9.mjs`) measures every visible piece of text in the panel on each step, in light, dark, and stronger contrast in both: more than 400 elements per step, none below WCAG AA.
- A code and accessibility review (an AI reviewer reading the code and running it, not a person using it) found 38 issues. The high-severity ones and most of the medium ones are fixed: Undo messages that could undo something newer, the item card going dead after Undo, results with no failure state, focus lost when numbers refresh, plan lists that could not be used from the keyboard, unreadable stronger-contrast colours in dark mode, markup injection from a hostile share link, the Wi-Fi placement not being safe against edits made while it runs, dialogs leaking keys to the map, and several confusing words. `tools/dev/plan11.mjs` checks these.
- **A simulated first-time-professor walkthrough was started but did not finish, so there is no walkthrough review yet. None of these are real faculty feedback.**

## What is not proven

- **No real professors have used it yet.** Before the contest, put it in front of three or four people who have never seen it, give them the task *"make the hostels' Wi-Fi better and tell me whether it worked"* and watch where they hesitate. Anything they stumble on twice is a bug.
- Hindi is not there yet. The wording is short and literal so it translates well, but it should be translated and read by a native speaker, not machine-translated.
- Screen-reader use has been designed for (labels, live regions, focus moves) but only checked by reading the code and testing with the keyboard, not with NVDA or VoiceOver. Placing things by clicking the map has the keyboard route described above, but drawing a large shape point by point is slow without a pointer.
- On a phone the panel is usable but cramped; it is meant for a laptop.
- Still open from the review, all minor: choices that exclude each other (Today / With this plan, text size, Rectangle / Any shape) are toggle buttons rather than radio groups; the gauge markers for today and the target differ only by shade and length; a few small buttons are 36 to 40 px rather than 44 px; and when focus sits inside the panel the arrow keys scroll the panel instead of flying the map (`W A S D` still fly it).
