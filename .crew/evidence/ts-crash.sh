#!/bin/bash
set -u
cd /tmp && rm -f crash.src.flv crash.ts crash.mp4 crash.mp4.log
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=640x360:rate=30 -f lavfi -i sine=frequency=440 -t 20 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -f flv crash.src.flv
ffmpeg -hide_banner -loglevel error -nostdin -re -i crash.src.flv -c copy -f mpegts crash.ts &
pid=$!
sleep 4
kill -9 $pid
wait $pid 2>/dev/null
ls -l crash.ts
ffmpeg -hide_banner -loglevel warning -nostdin -y -i crash.ts -c copy -movflags +faststart -f mp4 crash.mp4 2>/tmp/crash.mp4.log
echo "remux_exit=$?"
ffprobe -hide_banner -loglevel error -show_entries format=duration,size -of default=nw=1 crash.mp4
echo "--- warnings ---"; cat /tmp/crash.mp4.log
