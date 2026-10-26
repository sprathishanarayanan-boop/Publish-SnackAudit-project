import { useRef, useState } from 'react';
import { money } from '../api';

/** Revenue over time: area + line, with a hover/keyboard readout. Pure SVG. */
export function RevenueChart({ series, unit }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 720; const H = 240; const L = 56; const R = 24; const T = 16; const B = 28;
  const max = Math.max(1, ...series.map((s) => s.revenueCents));
  const nice = niceMax(max);
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, series.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / nice);
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.revenueCents).toFixed(1)}`).join('');
  const area = `${line}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const fmt = (d) => new Date(d).toLocaleString('en-IN', unit === 'hour' ? { hour: 'numeric' } : { day: 'numeric', month: 'short' });
  const step = Math.ceil(series.length / 8);

  const move = (e) => {
    const box = ref.current.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  };
  const h = hover !== null ? series[hover] : null;

  return (
    <figure className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue over time"
        onMouseMove={move} onMouseLeave={() => setHover(null)} tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((v) => Math.min(series.length - 1, (v ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? series.length) - 1));
        }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(nice * f)} y2={y(nice * f)} className="grid" />
            <text x={L - 8} y={y(nice * f) + 4} textAnchor="end" className="axis">{short(nice * f)}</text>
          </g>
        ))}
        {series.map((s, i) => (i % step === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} className="axis">{fmt(s.bucket)}</text> : null))}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {h && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} className="cursor" />
            <circle cx={x(hover)} cy={y(h.revenueCents)} r="4.5" className="dot" />
          </g>
        )}
      </svg>
      <figcaption className="readout" aria-live="polite">
        {h ? <><strong>{money(h.revenueCents)}</strong> from {h.tickets} tickets ({h.paidOrders} orders, {h.holds} holds) · {fmt(h.bucket)}</>
          : 'Hover or use arrow keys to inspect a period.'}
      </figcaption>
    </figure>
  );
}

/** One row per tier: sold (solid) and held (striped) against capacity. */
export function TierBars({ tiers }) {
  return (
    <ul className="tierbars">
      {tiers.map((t) => (
        <li key={t.id}>
          <div className="tb-label">
            <span>{t.name}<small>{t.eventTitle}</small></span>
            <span>{t.sold}/{t.quantity} sold · {money(t.revenueCents)}</span>
          </div>
          <div className="tb-track" role="img" aria-label={`${t.sold} sold, ${t.held} on hold, of ${t.quantity}`}>
            <i className="sold" style={{ width: `${(t.sold / t.quantity) * 100}%` }} />
            <i className="held" style={{ width: `${(t.held / t.quantity) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Hold → checkout → paid funnel with drop-off. */
export function Funnel({ funnel }) {
  const steps = [
    { label: 'Seats held', n: funnel.holds },
    { label: 'Started payment', n: funnel.checkouts },
    { label: 'Paid', n: funnel.paid },
  ];
  const top = Math.max(1, steps[0].n);
  return (
    <div className="funnel">
      {steps.map((s, i) => (
        <div key={s.label} className="f-step">
          <div className="f-bar" style={{ width: `${Math.max(4, (s.n / top) * 100)}%` }} />
          <div className="f-text">
            <strong>{s.n}</strong> {s.label}
            {i > 0 && steps[i - 1].n > 0 && <small>{Math.round((s.n / steps[i - 1].n) * 100)}% of previous step</small>}
          </div>
        </div>
      ))}
      <p className="f-foot">{funnel.expired} holds expired unpaid, {funnel.cancelled} cancelled, {funnel.rejected_payments} payments declined, {funnel.active} active now.</p>
    </div>
  );
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((c) => c >= v);
}
function short(cents) {
  const r = cents / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(0)}k`;
  return `₹${r.toFixed(0)}`;
}
