import { useEffect, useRef, useState } from "react";
import { api, json } from "./api";
import "./media-call.css";

type Config = RTCConfiguration & { has_turn: boolean };
type Signal = {
  id: number;
  sender_id: string;
  kind: "offer" | "answer" | "ice";
  sdp?: string;
  candidate?: RTCIceCandidateInit;
};
type Poll = {
  peers: { id: string; username: string }[];
  signals: Signal[];
  next_after: number;
};
export default function MediaCall({
  notebookId,
  token,
}: {
  notebookId: string;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [consent, setConsent] = useState(false);
  const [video, setVideo] = useState(false);
  const [active, setActive] = useState(false);
  const [joining, setJoining] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [needsPlay, setNeedsPlay] = useState(false);
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const remote = useRef<MediaStream | null>(null);
  const session = useRef<string | null>(null);
  const peer = useRef<{
    id: string;
    pc: RTCPeerConnection;
    queued: RTCIceCandidateInit[];
  } | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const base = `/v1/notebooks/${notebookId}/call`;
  const supported =
    typeof RTCPeerConnection !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    window.isSecureContext;

  function leaveOnServer(id: string) {
    void api(`${base}/sessions/${id}`, token, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  }
  function closePeer() {
    const old = peer.current;
    peer.current = null;
    if (old) {
      old.pc.onicecandidate = null;
      old.pc.ontrack = null;
      old.pc.onconnectionstatechange = null;
      old.pc.close();
    }
    remote.current?.getTracks().forEach((track) => track.stop());
    remote.current = null;
  }
  function cleanup(update = true) {
    generation.current++;
    controller.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    closePeer();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    const id = session.current;
    session.current = null;
    if (id) leaveOnServer(id);
    if (update) {
      setActive(false);
      setJoining(false);
      setLocalStream(null);
      setRemoteStream(null);
      setName("");
      setStatus("انتهت المكالمة على هذا الجهاز");
      setNeedsPlay(false);
    }
  }
  useEffect(() => {
    const end = () => cleanup();
    window.addEventListener("offline", end);
    window.addEventListener("pagehide", end);
    return () => {
      window.removeEventListener("offline", end);
      window.removeEventListener("pagehide", end);
      cleanup(false);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    api<Config>(base + "/config", token, { signal: c.signal })
      .then((value) => {
        if (!c.signal.aborted) setConfig(value);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError("تعذر تحميل إعدادات المكالمة أو لم تعد لديك صلاحية.");
      });
    return () => c.abort();
  }, [open, base, token]);
  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    const element = remoteVideo.current;
    if (element) {
      element.srcObject = remoteStream;
      if (remoteStream) void element.play().catch(() => setNeedsPlay(true));
    }
  }, [remoteStream]);

  async function join() {
    if (active || joining || !consent || !supported) return;
    cleanup();
    window.dispatchEvent(
      new CustomEvent("knowlm-audio-start", { detail: "call" }),
    );
    setJoining(true);
    setError("");
    setStatus("جارٍ طلب إذن الأجهزة والانضمام…");
    setMuted(false);
    setCameraOff(false);
    const run = generation.current;
    const c = new AbortController();
    controller.current = c;
    let cursor = 0,
      heartbeat = performance.now();
    const alive = () => generation.current === run && !c.signal.aborted;
    try {
      const settings = await api<Config>(base + "/config", token, {
        signal: c.signal,
      });
      if (!alive()) return;
      setConfig(settings);
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video,
      });
      if (!alive()) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      const id = crypto.randomUUID();
      session.current = id;
      await api(base + "/sessions", token, {
        ...json({ request_id: id, consent: true }),
        signal: c.signal,
      });
      if (!alive()) {
        leaveOnServer(id);
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      setLocalStream(acquired);
      setActive(true);
      setJoining(false);
      setStatus("في انتظار المشارك الثاني");
      async function send(target: string, value: object) {
        if (!alive()) return;
        await api(`${base}/sessions/${id}/signals`, token, {
          ...json({ target_id: target, ...value }),
          signal: c.signal,
        });
      }
      function failure() {
        if (alive()) {
          cleanup();
          setError(
            "انقطع اتصال المكالمة أو صلاحية الغرفة. أعد الانضمام للمحاولة؛ تحقق من إعداد TURN للشبكات المختلفة.",
          );
        }
      }
      async function connect(target: { id: string; username: string }) {
        closePeer();
        setRemoteStream(null);
        setName(target.username);
        setStatus("جارٍ إنشاء الاتصال بالطرف الآخر…");
        const pc = new RTCPeerConnection({
          iceServers: settings.iceServers,
          iceTransportPolicy: settings.iceTransportPolicy,
        });
        const record = {
          id: target.id,
          pc,
          queued: [] as RTCIceCandidateInit[],
        };
        peer.current = record;
        acquired.getTracks().forEach((track) => pc.addTrack(track, acquired));
        pc.onicecandidate = (event) => {
          if (event.candidate && alive() && peer.current === record)
            void send(target.id, {
              kind: "ice",
              candidate: event.candidate.toJSON(),
            }).catch(failure);
        };
        pc.ontrack = (event) => {
          if (!alive() || peer.current !== record) return;
          const incoming =
            event.streams[0] || remote.current || new MediaStream();
          if (!event.streams[0]) incoming.addTrack(event.track);
          remote.current = incoming;
          setRemoteStream(incoming);
        };
        pc.onconnectionstatechange = () => {
          if (!alive() || peer.current !== record) return;
          if (pc.connectionState === "connected") setStatus("المكالمة متصلة");
          else if (
            pc.connectionState === "failed" ||
            pc.connectionState === "disconnected"
          )
            failure();
        };
        // Exactly one offerer: no simultaneous-offer glare for this two-person room.
        if (id < target.id) {
          await pc.setLocalDescription(await pc.createOffer());
          await send(target.id, {
            kind: "offer",
            sdp: pc.localDescription!.sdp,
          });
        }
      }
      async function poll() {
        if (!alive()) return;
        try {
          const result = await api<Poll>(
            `${base}/sessions/${id}?after=${cursor}`,
            token,
            { signal: c.signal },
          );
          if (!alive()) return;
          const target = result.peers[0];
          if (!target) {
            if (peer.current) {
              closePeer();
              setRemoteStream(null);
              setName("");
            }
            setStatus("في انتظار المشارك الثاني");
          } else if (peer.current?.id !== target.id) await connect(target);
          for (const message of result.signals) {
            if (!alive()) return;
            const current = peer.current;
            if (!current || current.id !== message.sender_id) continue;
            const pc = current.pc;
            if (message.kind === "ice") {
              if (pc.remoteDescription)
                await pc.addIceCandidate(message.candidate!);
              else {
                if (current.queued.length >= 100)
                  throw new Error("ICE overflow");
                current.queued.push(message.candidate!);
              }
            } else {
              await pc.setRemoteDescription({
                type: message.kind,
                sdp: message.sdp!,
              });
              for (const ice of current.queued.splice(0))
                await pc.addIceCandidate(ice);
              if (message.kind === "offer") {
                await pc.setLocalDescription(await pc.createAnswer());
                await send(current.id, {
                  kind: "answer",
                  sdp: pc.localDescription!.sdp,
                });
              }
            }
          }
          cursor = result.next_after;
          if (performance.now() - heartbeat >= 10000) {
            await api(`${base}/sessions/${id}/heartbeat`, token, {
              ...json({ after: cursor }),
              signal: c.signal,
            });
            heartbeat = performance.now();
          }
          if (alive()) timer.current = setTimeout(() => void poll(), 1000);
        } catch {
          failure();
        }
      }
      void poll();
    } catch {
      if (alive()) {
        cleanup();
        setError(
          "تعذر الانضمام. تحقق من إذن الميكروفون/الكاميرا وعضوية الدفتر. الغرفة لشخصين وحساب واحد لكل تبويب؛ الجلسة المتروكة تنتهي خلال 90 ثانية.",
        );
      }
    }
  }
  return (
    <section className="media-call" aria-label="مكالمة الدفتر">
      <button
        type="button"
        className="outline"
        aria-expanded={open}
        onClick={() => {
          if (open) cleanup();
          setOpen(!open);
        }}
      >
        مكالمة صوت وفيديو · شخصان
      </button>
      {open && (
        <div>
          <p>
            مكالمة اختيارية بين عضوين من الدفتر، وليست بثًا عامًا. لا يسجل الخادم
            الصوت أو الفيديو. قد يكشف الاتصال عنوان الشبكة للطرف الآخر وخوادم
            STUN/TURN التي يحددها المشغل؛ يستطيع الطرف الآخر التسجيل خارج
            التطبيق. إغلاق هذا القسم أو مغادرة الصفحة يوقف الأجهزة.
          </p>
          {!supported && (
            <p>المكالمة تحتاج HTTPS ومتصفحًا يدعم WebRTC وأذونات الأجهزة.</p>
          )}
          {config && !config.has_turn && (
            <p className="external-warning">
              لا يوجد TURN مُعدّ: قد تعمل المكالمة داخل الشبكة نفسها فقط، ولا نضمن
              الاتصال بين شبكات مختلفة.
            </p>
          )}
          {!active && !joining && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={video}
                  onChange={(e) => setVideo(e.target.checked)}
                />
                إرسال فيديو الكاميرا أيضًا (الافتراضي صوت فقط)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                أوافق على تشغيل الأجهزة المحددة ومشاركة الوسائط وبيانات الاتصال
                مع العضو الآخر وخوادم الربط المُعدّة
              </label>
              <button
                type="button"
                disabled={!supported || !config || !consent}
                onClick={() => void join()}
              >
                انضم للمكالمة
              </button>
            </>
          )}
          {(active || joining) && (
            <button type="button" onClick={() => cleanup()}>
              {joining ? "إلغاء الانضمام" : "إنهاء المكالمة وإيقاف الأجهزة"}
            </button>
          )}
          {status && <p role="status">{status}</p>}
          {error && <p role="alert">{error}</p>}
          {active && (
            <>
              <div className="call-videos">
                <figure>
                  <video
                    ref={localVideo}
                    autoPlay
                    muted
                    playsInline
                    aria-label="معاينة أجهزتي"
                  />
                  <figcaption>أنت · المعاينة المحلية صامتة</figcaption>
                </figure>
                <figure>
                  <video
                    ref={remoteVideo}
                    autoPlay
                    playsInline
                    controls
                    aria-label="وسائط المشارك الآخر"
                  />
                  <figcaption>{name || "لا يوجد مشارك آخر بعد"}</figcaption>
                </figure>
              </div>
              <div className="tools-row">
                <button
                  type="button"
                  onClick={() => {
                    stream.current?.getAudioTracks().forEach((track) => {
                      track.enabled = muted;
                    });
                    setMuted(!muted);
                  }}
                >
                  {muted ? "إلغاء كتم الميكروفون" : "كتم الميكروفون"}
                </button>
                {localStream?.getVideoTracks().length ? (
                  <button
                    type="button"
                    onClick={() => {
                      stream.current?.getVideoTracks().forEach((track) => {
                        track.enabled = cameraOff;
                      });
                      setCameraOff(!cameraOff);
                    }}
                  >
                    {cameraOff
                      ? "تفعيل إرسال الكاميرا"
                      : "تعطيل إرسال الكاميرا"}
                  </button>
                ) : null}
                {needsPlay && (
                  <button
                    type="button"
                    onClick={() =>
                      void remoteVideo.current
                        ?.play()
                        .then(() => setNeedsPlay(false))
                        .catch(() =>
                          setError(
                            "المتصفح منع تشغيل الصوت. استخدم تحكم الفيديو.",
                          ),
                        )
                    }
                  >
                    تشغيل صوت الطرف الآخر
                  </button>
                )}
              </div>
              <p>
                الكتم/تعطيل الإرسال لا ينهي الجلسة؛ لإنهاء التقاط الأجهزة اضغط
                إنهاء المكالمة. تُفحص العضوية أثناء تحديث الربط؛ سحبها لا يمكنه
                سحب نسخ الوسائط التي وصلت بالفعل.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
