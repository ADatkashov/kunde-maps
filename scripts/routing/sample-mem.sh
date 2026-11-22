#!/bin/sh
# sample-mem.sh CONTAINER OUTFILE : record the peak memory (MiB) of a running container until it exits.
c=$1; out=$2; peak=0
while docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null | grep -q true; do
  raw=$(docker stats --no-stream --format '{{.MemUsage}}' "$c" 2>/dev/null | awk '{print $1}')
  mib=$(echo "$raw" | awk '/GiB/{sub("GiB","");printf "%d",$1*1024;next} /MiB/{sub("MiB","");printf "%d",$1;next} /KiB/{printf "0";next} {printf "0"}')
  [ "${mib:-0}" -gt "$peak" ] && peak=$mib
  echo "$peak" > "$out"
  sleep 1
done
echo "$peak" > "$out"
