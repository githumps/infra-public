"use strict";

// Fixture suite for parse.js (infra-public#54). Each fixture reproduces a
// bug class the guard has already regressed on in production (see
// check.issue-close-completeness.yml's header: 2026-07-12, 2026-07-13 Qodo
// review, #47) - this suite exists so the next parser change can be proven
// against these BEFORE merge, not discovered against a live issue after.
//
// Node stdlib only (node:test + node:assert) - no npm runtime dependency.
// Run: node --test .github/scripts/close-completeness/

const test = require("node:test");
const assert = require("node:assert/strict");
const { findUncheckedItems } = require("./parse.js");

test("checked item is not returned", () => {
  const body = "## Acceptance criteria\n\n- [x] done thing\n";
  assert.deepEqual(findUncheckedItems(body), []);
});

test("unchecked item is returned", () => {
  const body = "## Acceptance criteria\n\n- [ ] not done thing\n";
  assert.deepEqual(findUncheckedItems(body), ["not done thing"]);
});

// FIXED (#58): a new checkbox bullet immediately following an OPEN
// unchecked bullet - no blank line, no header between them - now flushes
// the open bullet to the unchecked list before tracking the new one. This
// is the common real-world Acceptance Criteria shape; the old clobber
// behavior silently dropped every item in a consecutive run except the
// last (a severe false-negative in the LIVE guard).
test("#58 fixed: consecutive unchecked bullets are ALL returned, mixed with checked ones", () => {
  const body = ["- [x] first (done)", "- [ ] second (open)", "- [X] third (done, capital X)", "- [ ] fourth (open)"].join(
    "\n",
  );
  assert.deepEqual(findUncheckedItems(body), ["second (open)", "fourth (open)"]);
});

// The regression fixture #58's acceptance criteria call for explicitly:
// 3+ consecutive unchecked items, the overwhelmingly common shape, ALL
// returned in order.
test("#58 regression: an unbroken run of three unchecked items returns all three", () => {
  const body = "- [ ] item one\n- [ ] item two\n- [ ] item three\n";
  assert.deepEqual(findUncheckedItems(body), ["item one", "item two", "item three"]);
});

test("bug class (a): line-wrapped continuation bullet is tracked and flushed on blank line", () => {
  const body = [
    "- [ ] a long acceptance criterion that wraps",
    "  onto a second line of plain continuation text",
    "",
    "next paragraph",
  ].join("\n");
  const result = findUncheckedItems(body);
  assert.equal(result.length, 1);
  assert.match(result[0], /wraps onto a second line/);
});

// FIXED (#58, same root cause as above): a continuation in progress is
// flushed - with its accumulated continuation text - when a real new
// checkbox bullet follows with no blank line.
test("#58 fixed: an in-progress continuation is flushed intact by an immediately-following real bullet", () => {
  const body = ["- [ ] first item wraps", "  continues here", "- [ ] second item"].join("\n");
  const result = findUncheckedItems(body);
  assert.deepEqual(result, ["first item wraps continues here", "second item"]);
});

test("a bullet-LIKE line that is NOT a valid checkbox correctly flushes the open bullet first (the one path that does work)", () => {
  // Contrast case: THIS is the branch the code's own comment describes
  // ("New bullet starts while tracking previous unchecked one -- flag the
  // old one") - it only actually fires for a line that starts with -/* but
  // does NOT match the stricter checkbox regex (no valid `[ ]`/`[x]`).
  const body = ["- [ ] open item", "- not a checkbox, plain bullet"].join("\n");
  assert.deepEqual(findUncheckedItems(body), ["open item"]);
});

test("bug class (a): continuation is flushed at end of body with no trailing blank line", () => {
  const body = ["## Acceptance criteria", "", "- [ ] wraps to", "  the last line of the body"].join("\n");
  const result = findUncheckedItems(body);
  assert.equal(result.length, 1);
  assert.match(result[0], /wraps to the last line of the body/);
});

test("bug class (b): a checkbox-looking line inside a fenced code block does not count", () => {
  const body = ["## Test plan", "", "```", "- [ ] this is example shell output, not a real checkbox", "```", ""].join(
    "\n",
  );
  assert.deepEqual(findUncheckedItems(body), []);
});

test("bug class (b): fence with an info string still toggles code-block state", () => {
  const body = ["```diff", "- [ ] not a real item, inside a diff fence", "```", "- [ ] this one IS real"].join("\n");
  assert.deepEqual(findUncheckedItems(body), ["this one IS real"]);
});

test("bug class (c): a real ATX header right after an unchecked bullet with no blank line does not swallow the bullet or get eaten as continuation", () => {
  const body = ["- [ ] the last unchecked item", "## Out of scope", "", "- [ ] this one is exempt, ignored"].join("\n");
  const result = findUncheckedItems(body);
  assert.deepEqual(result, ["the last unchecked item"]);
});

// KNOWN BUG, tracked in #58: isBoldHeader IS correctly gated to
// currentBulletChecked === null (so a **bold** line while tracking an open
// bullet is never misclassified as a section HEADER - that part of the
// code's comment is accurate). But a **bold** line ALSO starts with a
// literal `*`, so it falls into the SAME clobber-on-bullet-like-line path
// as #58's other cases, rather than genuine continuation text: the open
// bullet gets flushed (correctly) but the bold line's own content is
// discarded. #58's acceptance criteria accept exactly this outcome
// ("correctly flushes the prior bullet"): the bold line is emphasis
// prose, not a checklist item, so dropping ITS text while flagging the
// open bullet is the documented, deliberate behavior - no longer a bug.
test("#58 accepted behavior: a **bold** line after an open bullet flushes the bullet; the bold text itself is prose, not an item", () => {
  const body = ["- [ ] an item whose next line looks bold", "**not actually a header, just emphasis**"].join("\n");
  const result = findUncheckedItems(body);
  // The bold line's text ("not actually a header...") never appears in the
  // output at all - it is silently dropped, not appended as continuation.
  assert.deepEqual(result, ["an item whose next line looks bold"]);
});

test("bug class (c): a **bold** line with nothing open is not mistaken for an item or crash the parser", () => {
  const body = ["**Just a bold lead-in, no open bullet**", "", "- [ ] a real item after"].join("\n");
  assert.deepEqual(findUncheckedItems(body), ["a real item after"]);
});

for (const heading of ["Out of scope", "Blocked by", "Reverse-if-wrong", "Candidate", "Further notes"]) {
  test(`bug class (d): unchecked item under exempt section "${heading}" is ignored`, () => {
    const body = ["## Acceptance criteria", "", "- [ ] a real open item", "", `## ${heading}`, "", "- [ ] exempt, not counted"].join(
      "\n",
    );
    assert.deepEqual(findUncheckedItems(body), ["a real open item"]);
  });
}

test("bug class (d): leaving an exempt section for a normal section resumes counting", () => {
  const body = [
    "## Out of scope",
    "",
    "- [ ] exempt one",
    "",
    "## Test plan",
    "",
    "- [ ] this one counts",
  ].join("\n");
  assert.deepEqual(findUncheckedItems(body), ["this one counts"]);
});

test("bug class (d): a new bullet inside an exempt section resets tracking state (does not leak into the next real section)", () => {
  const body = [
    "## Out of scope",
    "",
    "- [ ] exempt item that wraps",
    "  more exempt continuation",
    "- [ ] second exempt item",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] real item",
  ].join("\n");
  assert.deepEqual(findUncheckedItems(body), ["real item"]);
});

test("item text is capped at 150 characters", () => {
  const long = "x".repeat(300);
  const body = `- [ ] ${long}`;
  const result = findUncheckedItems(body);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 150);
});

test("empty body returns an empty list", () => {
  assert.deepEqual(findUncheckedItems(""), []);
});

test("null/undefined body does not throw and returns an empty list", () => {
  assert.deepEqual(findUncheckedItems(null), []);
  assert.deepEqual(findUncheckedItems(undefined), []);
});

test("a body with no checkboxes at all returns an empty list", () => {
  const body = "Just prose, no acceptance criteria section at all.";
  assert.deepEqual(findUncheckedItems(body), []);
});

test("asterisk bullets are recognized the same as hyphen bullets", () => {
  const body = "* [ ] an asterisk-style unchecked item";
  assert.deepEqual(findUncheckedItems(body), ["an asterisk-style unchecked item"]);
});
