import { useEffect, useRef, useState } from "react";
import {
  ArmGate,
  ConfettiLayer,
  useConfetti,
  useDeadline,
  useEventLog,
  useFairRng,
  useFlashOnChange,
  useNamedPeer,
  useRoster,
  useShake,
  useVibration,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };
type PotatoEvent = {
  id: string;
  type: "start" | "fling" | "explode";
  from?: string;
  to?: string;
  peerId: string;
  ts: number;
};
const ROUND_MS = 15_000;

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="potato-screen">
        <h1>hot potato</h1>
        <p>Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const { name, setName, nameOf, myName } = useNamedPeer(config, room);
  const roster = useRoster(room);
  const log = useEventLog<PotatoEvent>(room, "events");
  const fair = useFairRng(room, "potato-salts");
  const vibe = useVibration();
  const { burst } = useConfetti();
  const [, rerender] = useState(0);
  const potato = room.doc.getMap<string | number>("potato");
  const eliminated = room.doc.getArray<string>("eliminated");

  useEffect(() => {
    const cb = () => rerender((n) => n + 1);
    potato.observe(cb);
    eliminated.observe(cb);
    return () => {
      potato.unobserve(cb);
      eliminated.unobserve(cb);
    };
  }, [potato, eliminated]);

  const holderId = (potato.get("holderId") as string | undefined) ?? "";
  const since = (potato.get("since") as number | undefined) ?? 0;
  const round = (potato.get("round") as number | undefined) ?? 0;
  const elimList = eliminated.toArray();
  const elimSet = new Set(elimList);
  const present = roster.present.length > 0 ? roster.present : [room.peerId];
  const alive = present.filter((p) => !elimSet.has(p));
  const iAmHolder = holderId === room.peerId;
  const iAmEliminated = elimSet.has(room.peerId);
  const deadline = useDeadline(since && holderId ? since + ROUND_MS : null);
  const flash = useFlashOnChange(holderId);

  const pickFirstHolder = () => {
    eliminated.delete(0, eliminated.length);
    const r = round + 1;
    const pool = fair.shuffle(present);
    const first = pool[0] ?? room.peerId;
    room.doc.transact(() => {
      potato.set("holderId", first);
      potato.set("since", Date.now());
      potato.set("round", r);
    });
    log.push({
      id: Math.random().toString(36).slice(2, 10),
      type: "start",
      to: first,
      peerId: room.peerId,
      ts: Date.now(),
    });
  };

  const fling = () => {
    if (!iAmHolder) return;
    const candidates = alive.filter((p) => p !== room.peerId);
    if (candidates.length === 0) return;
    const target = fair.shuffle(candidates)[0]!;
    room.doc.transact(() => {
      potato.set("holderId", target);
      potato.set("since", Date.now());
    });
    log.push({
      id: Math.random().toString(36).slice(2, 10),
      type: "fling",
      from: room.peerId,
      to: target,
      peerId: room.peerId,
      ts: Date.now(),
    });
    vibe.vibrate(80);
    fair.rerollMine();
  };

  // shake → fling
  const shake = useShake({ threshold: 16 });
  const lastShakeRef = useRef(0);
  useEffect(() => {
    if (shake.shakes > lastShakeRef.current) {
      lastShakeRef.current = shake.shakes;
      if (iAmHolder) fling();
    }
  }, [shake.shakes, iAmHolder]);

  // vibrate every 2s while holding
  useEffect(() => {
    if (!iAmHolder) return;
    const id = setInterval(() => vibe.vibrate([200, 100, 200]), 2000);
    return () => clearInterval(id);
  }, [iAmHolder, vibe]);

  // expiry: holder eliminates self + advances
  const expiredRef = useRef<string>("");
  useEffect(() => {
    if (!holderId || !since) return;
    if (!deadline.isPast) return;
    const tag = `${round}:${holderId}:${since}`;
    if (expiredRef.current === tag) return;
    if (!iAmHolder) return;
    expiredRef.current = tag;
    const survivors = alive.filter((p) => p !== room.peerId);
    room.doc.transact(() => {
      eliminated.push([room.peerId]);
      if (survivors.length >= 1) {
        const next = fair.shuffle(survivors)[0]!;
        potato.set("holderId", next);
        potato.set("since", Date.now());
      } else {
        potato.set("holderId", "");
        potato.set("since", 0);
      }
    });
    log.push({
      id: Math.random().toString(36).slice(2, 10),
      type: "explode",
      peerId: room.peerId,
      ts: Date.now(),
    });
  }, [deadline.isPast, holderId, since, round, iAmHolder]);

  // confetti for survivors when only one alive remains
  const wonRef = useRef(false);
  useEffect(() => {
    if (round > 0 && alive.length === 1 && !iAmEliminated && !wonRef.current) {
      wonRef.current = true;
      burst({ origin: "top", count: 120, hueRange: [10, 60] });
    }
    if (alive.length > 1) wonRef.current = false;
  }, [alive.length, round, iAmEliminated, burst]);

  const holderName = holderId ? (nameOf(holderId) ?? "someone") : "—";
  const sec = Math.ceil(deadline.remainingMs / 1000);

  return (
    <div className={`potato-screen${flash ? " potato-flash" : ""}`}>
      <ConfettiLayer />
      <h1>hot potato</h1>
      <input
        className="potato-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="your name"
        maxLength={32}
        aria-label="your name"
      />
      <ArmGate label="tap to enable shake + vibration">
        {() => <p className="potato-armed">shake + vibration on, {myName}</p>}
      </ArmGate>
      <div className="potato-display" aria-live="polite">
        {holderId ? (
          <>
            <span className="potato-emoji">🥔</span>
            <span className="potato-line">
              {holderName} has the potato 🥔 · {sec}s left
            </span>
          </>
        ) : (
          <span className="potato-line">no round in play</span>
        )}
      </div>
      {iAmHolder && (
        <button type="button" className="potato-fling" aria-label="FLING" onClick={fling}>
          FLING
        </button>
      )}
      <button
        type="button"
        className="potato-start"
        aria-label="start game"
        onClick={pickFirstHolder}
      >
        start game
      </button>
      <ul className="potato-alive">
        {present.map((p) => {
          const out = elimSet.has(p);
          return (
            <li key={p} className={out ? "potato-out" : ""}>
              {nameOf(p) ?? p.slice(0, 6)}
              {p === holderId ? " 🥔" : ""}
              {out ? " (out)" : ""}
            </li>
          );
        })}
      </ul>
      <ol className="potato-log">
        {log.latest(8).map((e) => (
          <li key={e.id}>
            {e.type === "start" && `round ${round} started → ${nameOf(e.to ?? "") ?? "?"}`}
            {e.type === "fling" &&
              `${nameOf(e.from ?? "") ?? "?"} flung 🥔 → ${nameOf(e.to ?? "") ?? "?"}`}
            {e.type === "explode" && `💥 ${nameOf(e.peerId) ?? "?"} exploded`}
          </li>
        ))}
      </ol>
    </div>
  );
}
