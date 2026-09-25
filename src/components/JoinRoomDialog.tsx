import type { FormEvent } from "react";

type Props = {
  roomName: string;
  userName: string;
  onRoomNameChange: (value: string) => void;
  onUserNameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export default function JoinRoomDialog({ roomName, userName, onRoomNameChange, onUserNameChange, onSubmit }: Props) {
  return <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "grid", placeItems: "center", background: "rgba(22, 24, 29, .36)" }}>
    <form onSubmit={onSubmit} style={{ width: "min(92vw, 380px)", padding: 24, borderRadius: 14, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,.24)" }}>
      <div style={{ marginBottom: 20 }}><div style={{ color: "#666", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Collaborative canvas</div><h1 style={{ margin: "6px 0", fontSize: 26 }}>Join a room</h1><p style={{ margin: 0, color: "#666", fontSize: 14 }}>Choose how you will appear to everyone inside.</p></div>
      <label style={{ display: "grid", gap: 6, marginBottom: 14, color: "#444", fontSize: 13, fontWeight: 600 }}>Room name<input value={roomName} onChange={(event) => onRoomNameChange(event.target.value)} autoFocus style={{ boxSizing: "border-box", width: "100%", padding: "10px 12px", border: "1px solid #ccc", borderRadius: 8, font: "inherit" }} /></label>
      <label style={{ display: "grid", gap: 6, marginBottom: 20, color: "#444", fontSize: 13, fontWeight: 600 }}>Your name<input value={userName} onChange={(event) => onUserNameChange(event.target.value)} style={{ boxSizing: "border-box", width: "100%", padding: "10px 12px", border: "1px solid #ccc", borderRadius: 8, font: "inherit" }} /></label>
      <button type="submit" style={{ width: "100%", padding: "11px 14px", border: 0, borderRadius: 8, background: "#1e1e1e", color: "#fff", font: "inherit", fontWeight: 700, cursor: "pointer" }}>Enter room</button>
    </form>
  </div>;
}
