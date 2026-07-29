"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PursuitPattern, TargetPoint } from "@/lib/types";

/**
 * Position of the stimulus at a point in the task, in normalised 0–1 stage
 * coordinates.
 *
 * @param progress Fraction of the task elapsed, 0–1.
 * @param pattern Which trajectory to follow.
 */
export function positionAt(
  progress: number,
  pattern: PursuitPattern,
): { x: number; y: number } {
  const tau = Math.PI * 2;
  switch (pattern) {
    case "circular":
      return {
        x: 0.5 + 0.34 * Math.cos(tau * 1.2 * progress),
        y: 0.5 + 0.3 * Math.sin(tau * 1.2 * progress),
      };
    case "lissajous":
      return {
        x: 0.5 + 0.36 * Math.sin(tau * 1.4 * progress),
        y: 0.5 + 0.28 * Math.sin(tau * 2.8 * progress),
      };
    case "step": {
      const slot = Math.floor(progress * 12) % 4;
      return {
        x: [0.16, 0.84, 0.5, 0.84][slot],
        y: [0.5, 0.5, 0.22, 0.78][slot],
      };
    }
    default:
      return {
        x: 0.5 + 0.38 * Math.sin(tau * 1.1 * progress),
        y: 0.5 + 0.1 * Math.sin(tau * 0.55 * progress),
      };
  }
}

export type CameraState = "idle" | "requesting" | "ready" | "denied" | "error";
export type TaskPhase = "idle" | "countdown" | "running" | "finished";

export interface RecordingResult {
  blob: Blob;
  extension: string;
  trajectory: TargetPoint[];
}

interface UsePursuitTaskOptions {
  durationSeconds: number;
  pattern: PursuitPattern;
  /** Called once the recording has stopped and the blob is assembled. */
  onComplete: (result: RecordingResult) => void;
}

/**
 * Camera, stimulus animation and recording for the pursuit task.
 *
 * The stimulus position is logged on every animation frame against the
 * recording's own time origin. That shared origin is what lets the backend
 * measure `tracking_error` against the real target path instead of falling
 * back to its self-consistency proxy, so the timing here is load-bearing.
 *
 * Mutable per-frame values live in refs, not state: the ball moves at 60fps and
 * re-rendering React on every frame would drop frames on a phone.
 */
export function usePursuitTask({
  durationSeconds,
  pattern,
  onComplete,
}: UsePursuitTaskOptions) {
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraMessage, setCameraMessage] = useState("");
  const [phase, setPhase] = useState<TaskPhase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [progress, setProgress] = useState(0);
  const [ballPosition, setBallPosition] = useState({ x: 0.5, y: 0.5 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const trajectoryRef = useRef<TargetPoint[]>([]);
  const rafRef = useRef(0);
  const startedAtRef = useRef(0);
  const abortedRef = useRef(false);
  const mimeRef = useRef("");
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  /** Attach the live stream to the preview element. */
  const attachStream = useCallback(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, []);

  const openCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraMessage("เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้อง");
      return;
    }
    if (!window.isSecureContext) {
      setCameraState("error");
      setCameraMessage(
        "ต้องเปิดผ่าน https:// หรือ http://localhost เท่านั้น จึงจะใช้กล้องได้",
      );
      return;
    }

    setCameraState("requesting");
    setCameraMessage("กำลังขอสิทธิ์เข้าถึงกล้อง…");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 15 },
        },
        audio: false,
      });
      attachStream();
      setCameraState("ready");
      setCameraMessage("กล้องพร้อมแล้ว — จัดใบหน้าให้อยู่ในกรอบ");
    } catch (error) {
      const denied = (error as Error).name === "NotAllowedError";
      setCameraState(denied ? "denied" : "error");
      setCameraMessage(
        denied
          ? "คุณปฏิเสธสิทธิ์กล้อง กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์แล้วลองใหม่"
          : `เปิดกล้องไม่ได้: ${(error as Error).message}`,
      );
    }
  }, [attachStream]);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraState("idle");
  }, []);

  const stopTask = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setPhase("finished");
    setProgress(0);
  }, []);

  const abort = useCallback(() => {
    abortedRef.current = true;
    stopTask();
    setPhase("idle");
  }, [stopTask]);

  const start = useCallback(async () => {
    if (!streamRef.current) return;

    abortedRef.current = false;
    chunksRef.current = [];
    trajectoryRef.current = [];
    setPhase("countdown");

    for (let value = 3; value > 0; value -= 1) {
      if (abortedRef.current) return;
      setCountdown(value);
      await new Promise((resolve) => window.setTimeout(resolve, 800));
    }
    if (abortedRef.current) return;

    const mime =
      ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      ) ?? "";
    mimeRef.current = mime || "video/webm";

    const recorder = new MediaRecorder(
      streamRef.current,
      mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined,
    );
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      if (abortedRef.current) return;
      const type = mimeRef.current;
      onCompleteRef.current({
        blob: new Blob(chunksRef.current, { type }),
        extension: type.includes("mp4") ? "mp4" : "webm",
        trajectory: trajectoryRef.current,
      });
    };
    recorder.start();
    recorderRef.current = recorder;

    startedAtRef.current = performance.now();
    setPhase("running");

    const tick = () => {
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      const ratio = elapsed / durationSeconds;
      if (ratio >= 1) {
        stopTask();
        return;
      }
      const point = positionAt(ratio, pattern);
      setBallPosition(point);
      setProgress(ratio);
      trajectoryRef.current.push({
        t: Number(elapsed.toFixed(4)),
        x: Number(point.x.toFixed(5)),
        y: Number(point.y.toFixed(5)),
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [durationSeconds, pattern, stopTask]);

  // Release the camera when the component unmounts, so the indicator light
  // does not stay on after navigating away.
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  return {
    videoRef,
    cameraState,
    cameraMessage,
    phase,
    countdown,
    progress,
    ballPosition,
    openCamera,
    closeCamera,
    attachStream,
    start,
    abort,
    hasStream: () => streamRef.current !== null,
  };
}
