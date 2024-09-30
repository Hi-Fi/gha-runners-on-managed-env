#!/bin/sh

FAIL=0

/home/runner/run.sh || FAIL=$?

# This clean up files, but leaves folders. No clear if those could be removed through mount or not.
/home/runner/cleanup_work.sh || FAIL=$?

exit $FAIL
