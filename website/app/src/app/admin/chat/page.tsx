// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/auth";
import AdminGate from "../AdminGate";

type Win = { chats: number; users: number; turns: number };
type Day = { day: string; tokens: number; input_tokens: number; output_tokens: number; cost_usd: number };
type Stats = {
  total: { tokens: number; input_tokens: number; output_tokens: number; cost_usd: number };
  windows: { all: Win; "7d": Win; "30d": Win };
  daily: Day[];
  pricing_configured: boolean;
};

const int = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export default function ChatAdminPage() {
  return <AdminGate title="Chat administration"><Dashboard /></AdminGate>;
}

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Stats>("GET", "/admin/chat/stats?days=30").then(setStats, (e) => setError(e.message)); }, []);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!stats) return <p>Loading…</p>;
  const { total, windows: w } = stats;
  return (
    <section>
      <div className="tiles">
        <Tile label="Total tokens" value={int(total.tokens)} sub={`${int(total.input_tokens)} in · ${int(total.output_tokens)} out`} />
        <Tile label="Total cost" value={usd(total.cost_usd)} sub={stats.pricing_configured ? "all time" : "set BLEEP_AGENT_PRICE_INPUT / _OUTPUT"} />
      </div>
      <h2>Chats and users</h2>
      <div className="scroll"><table>
        <thead><tr><th /><th>Total</th><th>Last 7 days</th><th>Last 30 days</th></tr></thead>
        <tbody>
          <tr><th scope="row">Chats</th><td>{int(w.all.chats)}</td><td>{int(w["7d"].chats)}</td><td>{int(w["30d"].chats)}</td></tr>
          <tr><th scope="row">Users</th><td>{int(w.all.users)}</td><td>{int(w["7d"].users)}</td><td>{int(w["30d"].users)}</td></tr>
          <tr><th scope="row">Messages</th><td>{int(w.all.turns)}</td><td>{int(w["7d"].turns)}</td><td>{int(w["30d"].turns)}</td></tr>
        </tbody>
      </table></div>
      <h2>Tokens per day</h2>
      <Bars days={stats.daily} value={(d) => d.tokens} format={int} />
      <h2>Cost per day</h2>
      <Bars days={stats.daily} value={(d) => d.cost_usd} format={usd} />
      <p className="muted">Last 30 days, UTC. A chat is a conversation; a message is one turn in it.</p>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="tile"><div className="muted">{label}</div><div className="big">{value}</div><div className="muted">{sub}</div></div>;
}

function Bars({ days, value, format }: { days: Day[]; value: (d: Day) => number; format: (n: number) => string }) {
  const max = Math.max(...days.map(value), 1e-9);
  const bw = 100 / days.length;
  return (
    <svg className="bars" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`Peak ${format(max)}`}>
      {days.map((d, i) => {
        const h = (value(d) / max) * 38;
        return <rect key={d.day} x={i * bw + bw * 0.1} width={bw * 0.8} y={40 - h} height={h}><title>{`${d.day}: ${format(value(d))}`}</title></rect>;
      })}
    </svg>
  );
}
