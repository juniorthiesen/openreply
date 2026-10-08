"use client";

/* eslint-disable @next/next/no-img-element -- Story previews use the protected media URL returned by the API. */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { MediaAsset } from "@/components/scheduling/shared";

/** Instagram shows a photo Story for about five seconds. */
const IMAGE_DURATION_MS = 5000;
/** A press longer than this pauses (like holding a Story) instead of skipping. */
const HOLD_MS = 220;

/**
 * Plays the sequence the way Instagram will: segmented progress bars, photos
 * for five seconds, videos for their length, tap right/left to skip, hold to
 * pause. Layout follows the Stories redesign (phone frame, header, reply bar).
 */
export function StoryPlayer({
  assets,
  username,
}: {
  assets: MediaAsset[];
  username: string | null;
}) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pressStart = useRef(0);
  const progressRef = useRef(0);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const count = assets.length;
  const current = count ? Math.min(index, count - 1) : 0;
  const asset = assets[current];
  const isVideo = Boolean(asset && !asset.contentType.startsWith("image/"));
  const paused = held || manualPause;

  const go = useCallback(
    (offset: 1 | -1) => {
      if (!count) return;
      setProgress(0);
      setIndex((value) => (Math.min(value, count - 1) + offset + count) % count);
    },
    [count]
  );

  // Photos advance on a timer; videos report their own progress below.
  useEffect(() => {
    if (!asset || isVideo || paused) return;
    let frame = 0;
    let last = performance.now();
    // Resuming after a pause continues from where the bar stopped.
    let elapsed = progressRef.current * IMAGE_DURATION_MS;
    const tick = (now: number) => {
      elapsed += now - last;
      last = now;
      if (elapsed >= IMAGE_DURATION_MS) {
        go(1);
        return;
      }
      setProgress(elapsed / IMAGE_DURATION_MS);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [asset, isVideo, paused, go, current]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch(() => undefined);
  }, [paused, current]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    pressStart.current = performance.now();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld(true);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    setHeld(false);
    if (performance.now() - pressStart.current > HOLD_MS) return;
    const box = event.currentTarget.getBoundingClientRect();
    go(event.clientX - box.left < box.width * 0.3 ? -1 : 1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") go(1);
    else if (event.key === "ArrowLeft") go(-1);
    else if (event.key === " ") setManualPause((value) => !value);
    else return;
    event.preventDefault();
  }

  const handle = username ?? "sua.conta";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Prévia</p>
        {count > 0 && (
          <p className="text-xs text-muted">
            Quadro {current + 1} de {count}
            {paused ? " · pausado" : ""}
          </p>
        )}
      </div>

      <div
        role="region"
        aria-roledescription="prévia de Stories"
        aria-label={count ? `Quadro ${current + 1} de ${count}. Setas para navegar, espaço para pausar.` : "Prévia de Stories"}
        tabIndex={count ? 0 : -1}
        onKeyDown={handleKeyDown}
        className="relative mx-auto flex aspect-[9/16] w-full max-w-[300px] select-none flex-col overflow-hidden rounded-[40px] border-[10px] border-foreground bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        {asset ? (
          <>
            {isVideo ? (
              <video
                key={asset.id}
                ref={videoRef}
                src={asset.publicUrl ?? undefined}
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                playsInline
                onTimeUpdate={(event) => {
                  const video = event.currentTarget;
                  if (video.duration) setProgress(video.currentTime / video.duration);
                }}
                onEnded={() => go(1)}
              />
            ) : (
              <img
                key={asset.id}
                src={asset.publicUrl ?? undefined}
                alt={`Quadro ${current + 1}: ${asset.fileName}`}
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}

            {/* Like Instagram, scrims keep the header and reply bar legible on light frames. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" />

            <div className="relative flex gap-[3px] px-3 pt-3.5">
              {assets.map((item, position) => (
                <span key={item.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/40">
                  <span
                    className="block h-full rounded-full bg-white"
                    style={{
                      width: `${position < current ? 100 : position === current ? Math.round(progress * 100) : 0}%`,
                    }}
                  />
                </span>
              ))}
            </div>

            <div className="relative flex items-center gap-2 px-3 py-2.5">
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full border-2 border-white bg-[#2F3A4A] text-[11px] font-semibold uppercase">
                {handle.slice(0, 2)}
              </span>
              <span className="truncate text-[13px] font-semibold">{handle}</span>
              <span className="text-xs opacity-75">agora</span>
            </div>

            {/* Tap zones: left 30% goes back, the rest forward; hold pauses. */}
            <div
              className="relative flex-1 cursor-pointer"
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setHeld(false)}
            />

            <div className="relative flex items-center gap-2.5 px-3 pb-4 pt-3">
              <span className="flex h-10 flex-1 items-center rounded-full border border-white/70 px-4 text-[13px]">
                Enviar mensagem
              </span>
            </div>
          </>
        ) : (
          <div className="m-auto px-6 text-center">
            <span className="text-3xl">▧</span>
            <p className="mt-3 text-sm text-white/70">Adicione quadros para ver a sequência rodando</p>
          </div>
        )}
      </div>

      <p className="mx-auto max-w-[300px] text-center text-xs text-muted">
        {count
          ? "Toque à direita para avançar, à esquerda para voltar e segure para pausar."
          : "Formato vertical (9:16) recomendado para Stories."}
      </p>
    </div>
  );
}
