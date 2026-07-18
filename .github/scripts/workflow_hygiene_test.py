#!/usr/bin/env python3
"""Fixture suite for workflow_hygiene.py (infra-public#46).

Each fixture constructs a small in-memory YAML snippet that should or
should not trigger one of the four ported rules, so a change to the
linter's regexes/block-extraction is proven against these before it can
silently regress (e.g. the MULTILINE anchor bug this suite pins: a
`timeout-minutes:` that isn't literally the first line of a job's block
was never detected, even when present).

Python stdlib only (unittest) - no pytest/uv dependency, matching the
script's own zero-dependency design.

Run: python3 .github/scripts/workflow_hygiene_test.py
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from workflow_hygiene import (
    lint_curl_timeouts,
    lint_file,
    lint_job_timeouts,
    lint_shell_script,
)

DUMMY = Path("workflows/dummy.yml")


class ShaPinning(unittest.TestCase):
    def _lint(self, text: str) -> list[str]:
        # lint_file() takes a path (it reads the file itself), so exercise
        # it through a real temp file rather than duplicating its logic.
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False) as f:
            f.write(text)
            path = Path(f.name)
        try:
            return lint_file(path)
        finally:
            path.unlink()

    def test_full_sha_passes(self):
        text = "steps:\n  - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd  # v5\n"
        self.assertEqual(self._lint(text), [])

    def test_floating_tag_fails(self):
        text = "steps:\n  - uses: actions/checkout@v4\n"
        errors = self._lint(text)
        self.assertEqual(len(errors), 1)
        self.assertIn("unpinned action", errors[0])

    def test_local_composite_action_is_not_checked(self):
        text = "steps:\n  - uses: ./.github/actions/my-composite\n"
        self.assertEqual(self._lint(text), [])


class CurlTimeouts(unittest.TestCase):
    def test_curl_with_both_flags_passes(self):
        lines = [
            "run: |",
            '  curl --max-time 30 --connect-timeout 10 "$URL"',
        ]
        errors = lint_curl_timeouts(DUMMY, "\n".join(lines))
        self.assertEqual(errors, [])

    def test_curl_missing_both_flags_fails(self):
        lines = [
            "run: |",
            '  curl "$URL"',
        ]
        errors = lint_curl_timeouts(DUMMY, "\n".join(lines))
        self.assertEqual(len(errors), 1)
        self.assertIn("curl missing", errors[0])

    def test_curl_in_description_prose_is_not_flagged(self):
        # A `description:` field mentioning curl is YAML metadata text, not
        # shell code - it must not be scoped into a `run: |` block.
        lines = [
            "inputs:",
            "  foo:",
            '    description: "runs curl --max-time under the hood"',
            "run: |",
            "  echo hi",
        ]
        errors = lint_curl_timeouts(DUMMY, "\n".join(lines))
        self.assertEqual(errors, [])

    def test_allow_marker_on_curl_line_suppresses(self):
        lines = [
            "run: |",
            '  curl "$URL" # hygiene: allow-curl-no-timeout flags live in $ARGS',
        ]
        errors = lint_curl_timeouts(DUMMY, "\n".join(lines))
        self.assertEqual(errors, [])

    def test_allow_marker_several_comment_lines_above_suppresses(self):
        # The marker doesn't have to be the literal line directly above -
        # a wrapped multi-line reason comment is legitimate (regression
        # test for the smoke-test.yml false positive this rule originally hit).
        lines = [
            "run: |",
            "  # hygiene: allow-curl-no-timeout both flags are set in args[]",
            "  # above - a static linter can't trace the array back to",
            "  # this call.",
            '  resp=$(curl "${args[@]}")',
        ]
        errors = lint_curl_timeouts(DUMMY, "\n".join(lines))
        self.assertEqual(errors, [])

    def test_allow_marker_scan_stops_at_non_comment_line(self):
        # A marker separated from the curl call by a real code line must
        # NOT suppress - the scan-upward-through-comments logic should
        # stop at the first non-comment line.
        lines = [
            "run: |",
            "  # hygiene: allow-curl-no-timeout unrelated call above",
            "  echo unrelated",
            '  curl "$URL"',
        ]
        errors = lint_curl_timeouts(DUMMY, "\n".join(lines))
        self.assertEqual(len(errors), 1)


class SetE(unittest.TestCase):
    def test_set_e_present_passes(self):
        self.assertEqual(lint_shell_script(Path("x.sh"), "#!/bin/sh\nset -euo pipefail\necho hi\n"), [])

    def test_missing_set_e_fails(self):
        errors = lint_shell_script(Path("x.sh"), "#!/bin/sh\necho hi\n")
        self.assertEqual(len(errors), 1)

    def test_allow_marker_suppresses(self):
        text = "#!/bin/sh\n# hygiene: allow-no-set-e this script is intentionally best-effort\necho hi\n"
        self.assertEqual(lint_shell_script(Path("x.sh"), text), [])


class JobTimeouts(unittest.TestCase):
    def test_job_with_timeout_as_second_key_passes(self):
        # Regression test for the MULTILINE anchor bug: timeout-minutes:
        # sitting after runs-on: (i.e. NOT the first line of the job's
        # block) must still be detected.
        text = "\n".join([
            "jobs:",
            "  build:",
            "    runs-on: ubuntu-latest",
            "    timeout-minutes: 10",
            "    steps:",
            "      - run: echo hi",
        ])
        self.assertEqual(lint_job_timeouts(DUMMY, text), [])

    def test_job_with_templated_timeout_input_passes(self):
        text = "\n".join([
            "jobs:",
            "  smoke:",
            "    runs-on: ${{ inputs.runner }}",
            "    timeout-minutes: ${{ inputs.timeout-minutes }}",
            "    steps:",
            "      - run: echo hi",
        ])
        self.assertEqual(lint_job_timeouts(DUMMY, text), [])

    def test_job_missing_timeout_fails(self):
        text = "\n".join([
            "jobs:",
            "  build:",
            "    runs-on: ubuntu-latest",
            "    steps:",
            "      - run: echo hi",
        ])
        errors = lint_job_timeouts(DUMMY, text)
        self.assertEqual(len(errors), 1)
        self.assertIn("job `build`", errors[0])

    def test_reusable_caller_job_with_uses_is_exempt(self):
        text = "\n".join([
            "jobs:",
            "  call-check:",
            "    uses: ./.github/workflows/check.python.yml",
            "    with:",
            "      runner: ubuntu-latest",
        ])
        self.assertEqual(lint_job_timeouts(DUMMY, text), [])

    def test_allow_marker_suppresses(self):
        text = "\n".join([
            "jobs:",
            "  build:",
            "    runs-on: ubuntu-latest",
            "    # hygiene: allow-no-timeout-minutes short-lived, self-limiting job",
            "    steps:",
            "      - run: echo hi",
        ])
        self.assertEqual(lint_job_timeouts(DUMMY, text), [])

    def test_two_jobs_only_second_missing_timeout(self):
        text = "\n".join([
            "jobs:",
            "  build:",
            "    runs-on: ubuntu-latest",
            "    timeout-minutes: 10",
            "    steps:",
            "      - run: echo one",
            "  test:",
            "    runs-on: ubuntu-latest",
            "    steps:",
            "      - run: echo two",
        ])
        errors = lint_job_timeouts(DUMMY, text)
        self.assertEqual(len(errors), 1)
        self.assertIn("job `test`", errors[0])


if __name__ == "__main__":
    unittest.main()
