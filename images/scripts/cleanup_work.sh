#!/bin/sh


WORK_DIR=/home/runner/_work

echo "Cleaning up directory $WORK_DIR (except externals)"

for dir in $WORK_DIR/*; do
    [ "$dir" = "$WORK_DIR/externals" ] && continue
    rm -rf "$dir"
done

echo "Cleanup done"
