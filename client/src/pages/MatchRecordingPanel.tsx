import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Circle, FileVideo2, Square, Upload } from "lucide-react";
import { SpinnerButton } from "@/components/Primitives";

type RecordingStatus = "AWAITING_STAKES" | "READY" | "IN_PROGRESS" | "AWAITING_EVIDENCE" | "UNDER_REVIEW" | "COMPLETED" | "DRAWN" | string;
const MAX_BYTES = 32 * 1024 * 1024;
const ACCEPTED_TYPES = ["video/webm", "video/mp4", "video/quicktime"];

export type MatchRecordingSummary = {
  id: number;
  username: string;
  side: "home" | "away";
  mimeType: "video/webm" | "video/mp4" | "video/quicktime";
  sizeBytes: number;
  uploadedAt: Date | string;
  expiresAt: Date | string | null;
  isMine: boolean;
  url?: string;
};

type Props = {
  matchId: number;
  status: RecordingStatus;
  evidenceDeadline?: Date | string | null;
  existing?: MatchRecordingSummary;
  onUploaded: () => Promise<unknown>;
};

export default function MatchRecordingPanel({ matchId, status, evidenceDeadline, existing, onUploaded }: Props) {
  const [sharing, setSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [captured, setCaptured] = useState<Blob | null>(null);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const uploadInProgressRef = useRef(false);
  const uploadCompleteRef = useRef(false);

  const uploadBlob = useCallback(async (blob: Blob) => {
    if (uploadInProgressRef.current || uploadCompleteRef.current) return;
    if (!ACCEPTED_TYPES.includes(blob.type.split(";")[0].toLowerCase())) {
      setError("Use a WebM, MP4 or QuickTime video.");
      return;
    }
    if (blob.size < 64 || blob.size > MAX_BYTES) {
      setError("Video must be at least 64 bytes and no larger than 32 MB. Use your device's compressed screen recording if needed.");
      return;
    }
    uploadInProgressRef.current = true;
    setUploading(true);
    setError("");
    try {
      const response = await fetch(`/api/match-recordings/${matchId}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": blob.type.split(";")[0],
          "X-Pace-Arena-Request": "1",
        },
        body: blob,
      });
      if (!response.ok) {
        let message = "The recording could not be saved.";
        try {
          const result = await response.json() as { error?: string };
          if (result.error) message = result.error;
        } catch { /* Keep the safe generic message for non-JSON responses. */ }
        throw new Error(message);
      }
      uploadCompleteRef.current = true;
      setCaptured(null);
      setManualFile(null);
      await onUploaded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recording could not be saved. Retry the upload or choose a local recording.");
    } finally {
      uploadInProgressRef.current = false;
      setUploading(false);
    }
  }, [matchId, onUploaded]);

  const startRecording = useCallback((stream: MediaStream) => {
    if (recorderRef.current || uploadCompleteRef.current || existing) return;
    if (typeof MediaRecorder === "undefined") {
      setError("This browser cannot record a shared screen. Use the manual video upload instead.");
      return;
    }
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported?.(type));
    try {
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 128_000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "video/webm";
        const clip = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;
        setRecording(false);
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setSharing(false);
        if (clip.size < 64) return;
        setCaptured(clip);
        void uploadBlob(clip);
      };
      recorder.onerror = () => setError("Browser recording stopped unexpectedly. Upload a saved gameplay video if available.");
      recorderRef.current = recorder;
      recorder.start(1000);
      setRecording(true);
    } catch {
      setError("Screen recording could not start in this browser. Use the manual upload instead.");
      stream.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setSharing(false);
    }
  }, [existing, uploadBlob]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    if (status === "IN_PROGRESS" && !recorderRef.current) startRecording(stream);
    if (status !== "IN_PROGRESS" && recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, [status, sharing, startRecording]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const beginScreenShare = async () => {
    setError("");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen capture is unavailable here. Use the manual upload for a locally recorded clip.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 10, max: 12 }, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setSharing(true);
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
        streamRef.current = null;
        setSharing(false);
      }, { once: true });
      if (status === "IN_PROGRESS") startRecording(stream);
    } catch {
      setError("Screen sharing was cancelled or denied. You can still upload a saved recording after the match.");
    }
  };

  const canPrepareCapture = ["AWAITING_STAKES", "READY", "IN_PROGRESS"].includes(status);
  const liveMatch = status === "IN_PROGRESS";
  const screenCaptureAvailable = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function" && typeof MediaRecorder !== "undefined";
  const evidenceWindowOpen = !!evidenceDeadline && new Date(evidenceDeadline).getTime() >= Date.now();
  const canUploadFile = status === "UNDER_REVIEW" || (["AWAITING_EVIDENCE", "COMPLETED", "DRAWN"].includes(status) && evidenceWindowOpen);
  const uploaded = Boolean(existing) || uploadCompleteRef.current;

  return <section className="card" style={liveMatch ? { borderColor: "var(--amber)" } : undefined} aria-labelledby={`recording-title-${matchId}`}>
    <div className="card-header">
      <div><h3 id={`recording-title-${matchId}`}>Match screen recording</h3><p>Supplementary dispute evidence. {liveMatch ? "The match is live; you can start recording now." : "You can prepare the screen capture before kickoff."} Browser approval is required, no microphone audio is captured, and video does not automatically verify the scoreboard.</p></div>
      {recording ? <span className="notice notice-warning" role="status" aria-live="polite"><Circle size={13} color="var(--amber)" fill="var(--amber)" /> RECORDING LIVE</span> : liveMatch ? <span className="notice notice-warning" role="status" aria-live="polite">Match live · recording not started</span> : <Camera size={17} color="var(--lime)" aria-hidden="true" />}
    </div>
    {uploaded ? <div className="notice"><strong>Recording received.</strong> The clip is encrypted and restricted to you and, during review, authorized administrators. It is scheduled for deletion after the evidence window unless a review/dispute keeps it temporarily.</div> : <>
      {canPrepareCapture && <div className="page-stack">
        <div className={`notice${liveMatch ? " notice-warning" : ""}`} role="status">{liveMatch ? <><strong>Match in progress.</strong> Choose Start screen recording, then approve sharing the game screen in your browser prompt. Recording will begin after approval.</> : <><strong>Before kickoff:</strong> Choose your game screen now so recording starts when both players confirm and the server starts the match.</>}</div>
        <div className="form-actions">
          {sharing ? <>
            <span className={`notice${recording ? " notice-warning" : ""}`} role="status" aria-live="polite">{recording ? <><Circle size={13} color="var(--amber)" fill="var(--amber)" /> Recording the selected screen now</> : liveMatch ? "Screen is shared, but recording is not active." : "Screen chosen · waiting for kickoff"}</span>
            <SpinnerButton type="button" className="button button-danger" onClick={() => { const active = recorderRef.current; if (active?.state === "recording") active.stop(); else streamRef.current?.getTracks().forEach(track => track.stop()); }}><Square size={14} />{recording ? "Stop and upload" : "Stop sharing"}</SpinnerButton>
          </> : screenCaptureAvailable ? <SpinnerButton type="button" disabled={uploading} onClick={() => void beginScreenShare()}><Camera size={15} />{liveMatch ? "Start screen recording" : "Choose screen before kickoff"}</SpinnerButton> : <div className="notice notice-warning" role="status">Live screen recording is not supported in this browser. After the match, upload a saved recording during the evidence window.</div>}
        </div>
      </div>}
      {canUploadFile && <div className="form-grid">
        <div className="field full"><label htmlFor={`match-video-${matchId}`}>Upload a saved gameplay recording</label><input id={`match-video-${matchId}`} className="input" type="file" accept="video/webm,video/mp4,video/quicktime" onChange={event => { setManualFile(event.target.files?.[0] ?? null); setError(""); }} /><span className="field-help">For console or mobile play, upload a saved WebM, MP4 or QuickTime recording · maximum 32 MB. Upload before the evidence deadline, except while the match is under review.</span></div>
        {manualFile && <div className="field full"><SpinnerButton type="button" busy={uploading} disabled={uploading || uploaded} onClick={() => void uploadBlob(manualFile)}><Upload size={14} />Upload video</SpinnerButton></div>}
      </div>}
      {captured && !uploading && error && <div className="form-actions"><SpinnerButton type="button" onClick={() => void uploadBlob(captured)}><Upload size={14} />Retry recording upload</SpinnerButton></div>}
      {uploading && <div className="notice" role="status"><FileVideo2 size={14} /> Uploading encrypted video evidence…</div>}
      {sharing && !liveMatch && <div className="field-help">The selected screen is armed. Once both players are ready and the match begins, recording starts.</div>}
      {error && <div className="notice notice-warning" role="alert">{error}</div>}
    </>}
    {existing?.url && <div className="form-actions"><a className="button button-ghost" href={existing.url} target="_blank" rel="noreferrer">View your uploaded recording</a></div>}
  </section>;
}
