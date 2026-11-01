import { PERIOD_PRESETS, periodRange } from '../lib/reportLogic'
import { todayJakarta } from '../lib/format'

// Tombol periode cepat. Menyala bila rentang from-to sama dengan salah satu preset.
export default function PeriodPresets({ from, to, onPick }) {
  const today = todayJakarta()
  return (
    <div className="segmented" role="group" aria-label="Periode cepat">
      {PERIOD_PRESETS.map(([key, label]) => {
        const r = periodRange(key, today)
        return (
          <button key={key} type="button" aria-pressed={from === r.from && to === r.to} onClick={() => onPick(r)}>{label}</button>
        )
      })}
    </div>
  )
}
