#!/usr/bin/env bash
# Commit and push whatever the baseline run rewrote. Shared by both platform
# jobs so they cannot drift in how they land their work.
#
# The pull --rebase is not a nicety. Both jobs push to the same branch, one
# after the other, and the second one's checkout predates the first one's
# commit — without it the push is rejected and a whole platform's refresh is
# thrown away with a red X that reads like a test failure.
set -euo pipefail
platform="${1:?platform name required}"

git config --global --add safe.directory "$PWD"
git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add checks/visual.spec.js-snapshots
if git diff --cached --quiet; then
  echo "Baselines already current for ${platform}."
  exit 0
fi

# Name the platform in the message. "Refresh visual baselines" twice in a row
# says nothing about which half moved, and the whole reason this workflow was
# rewritten is that nobody could see which half had been left behind.
git commit -m "Refresh ${platform} visual baselines"

branch="${GITHUB_REF_NAME}"
for attempt in 1 2 3; do
  if git pull --rebase origin "${branch}" && git push origin "HEAD:${branch}"; then
    echo "Pushed ${platform} baselines to ${branch}."
    exit 0
  fi
  echo "Push attempt ${attempt} failed; retrying."
  sleep 5
done
echo "Could not push ${platform} baselines after 3 attempts." >&2
exit 1
