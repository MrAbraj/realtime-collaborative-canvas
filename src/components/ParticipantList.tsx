import type { Participant } from "../features/collaboration/types";

type Props = { participants: Record<string, Participant>; open: boolean; onToggle: () => void };

export default function ParticipantList({ participants, open, onToggle }: Props) {
  const list = Object.values(participants);
  return <div style={{ position: "fixed", top: 16, right: 16, zIndex: 30 }}>
    <button type="button" onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #d8d8d8", borderRadius: 8, background: "#fff", padding: 6, boxShadow: "0 2px 10px rgba(0,0,0,.12)", cursor: "pointer" }}>
      <span style={{ display: "flex" }}>{list.slice(0, 3).map((participant, index) => <span key={participant.userId} title={participant.name} style={{ display: "grid", placeItems: "center", width: 28, height: 28, marginLeft: index === 0 ? 0 : -7, border: "2px solid #fff", borderRadius: "50%", background: participant.color, color: "#fff", fontSize: 12, fontWeight: 700 }}>{participant.name.charAt(0).toUpperCase()}</span>)}</span>
      <span style={{ color: "#555", fontSize: 13 }}>{list.length > 3 ? `+${list.length - 3}` : ""}⌄</span>
    </button>
    {open && <div style={{ position: "absolute", top: 46, right: 0, width: 220, maxHeight: 200, overflowY: "auto", padding: 8, border: "1px solid #ddd", borderRadius: 8, background: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,.16)" }}>{list.map((participant) => <div key={participant.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: 13 }}><span style={{ display: "grid", placeItems: "center", flex: "0 0 auto", width: 28, height: 28, borderRadius: "50%", background: participant.color, color: "#fff", fontWeight: 700 }}>{participant.name.charAt(0).toUpperCase()}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{participant.name}</span></div>)}</div>}
  </div>;
}
