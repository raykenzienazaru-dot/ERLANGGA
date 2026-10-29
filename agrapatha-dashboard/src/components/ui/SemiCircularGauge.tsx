import React from 'react';

interface SemiCircularGaugeProps {
  value: number;
  min?: number;
  max?: number;
  title: string;
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'SAFE' | 'CRITICAL';
  unit?: string;
  subLabel?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const SemiCircularGauge: React.FC<SemiCircularGaugeProps> = ({
  value,
  min = 0,
  max = 100,
  title,
  level,
  unit = '%',
  subLabel,
  size = 'md',
}) => {
  const clampedValue = Math.min(max, Math.max(min, value));
  const percentage = (clampedValue - min) / (max - min);

  // Gauge geometry: center at (100, 95), radius 75
  const cx = 100;
  const cy = 95;
  const r = 74;
  const strokeWidth = 12;

  // Total semi-circle circumference: Math.PI * r ≈ 232.48
  const arcLength = Math.PI * r;
  const strokeDashoffset = arcLength * (1 - percentage);

  // Needle angle: percentage 0 -> 180deg (left), percentage 1 -> 0deg (right)
  const needleAngle = 180 - percentage * 180;
  const needleRad = (needleAngle * Math.PI) / 180;
  const needleLength = r - 12;
  const needleX = cx + needleLength * Math.cos(needleRad);
  const needleY = cy - needleLength * Math.sin(needleRad);

  const getLevelColor = (lvl: string) => {
    switch (lvl) {
      case 'HIGH':
      case 'CRITICAL':
        return '#DC2626';
      case 'MODERATE':
        return '#D97706';
      case 'LOW':
      case 'SAFE':
      default:
        return '#56612E';
    }
  };

  const activeColor = getLevelColor(level);

  const dimensionClass =
    size === 'sm'
      ? 'w-40 max-w-full'
      : size === 'lg'
      ? 'w-64 max-w-full'
      : 'w-52 max-w-full';

  return (
    <div className="flex flex-col items-center select-none">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#4D6A75] mb-1 block">
        {title}
      </span>

      <div className={`relative ${dimensionClass}`}>
        <svg viewBox="0 0 200 120" className="w-full h-auto overflow-visible">
          <defs>
            {/* Background Zone Gradients */}
            <linearGradient id="gaugeZoneGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#56612E" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#D97706" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#DC2626" stopOpacity="0.4" />
            </linearGradient>

            <linearGradient id="gaugeActiveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#56612E" />
              <stop offset="55%" stopColor="#4E8577" />
              <stop offset="85%" stopColor="#D97706" />
              <stop offset="100%" stopColor="#DC2626" />
            </linearGradient>

            <filter id="gaugeShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
            </filter>
          </defs>

          {/* Background Track with Color Zone Segments */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="#E5EBE8"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Color Zone Highlights (Dotted / Subdivided Reference) */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="url(#gaugeZoneGrad)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Active Filled Arc */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="url(#gaugeActiveGrad)"
            strokeWidth={strokeWidth}
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />

          {/* Needle Indicator */}
          <line
            x1={cx}
            y1={cy}
            x2={needleX}
            y2={needleY}
            stroke="#2C2922"
            strokeWidth="2.5"
            strokeLinecap="round"
            filter="url(#gaugeShadow)"
            className="transition-all duration-500 ease-out"
          />
          <circle cx={cx} cy={cy} r="5" fill="#2C2922" />
          <circle cx={cx} cy={cy} r="2.5" fill="#FFFFFF" />

          {/* Scale Min / Max Labels */}
          <text
            x={cx - r - 4}
            y={cy + 16}
            fontSize="9"
            fill="#7E694F"
            fontWeight="600"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {min}
          </text>
          <text
            x={cx}
            y={cy - r + 14}
            fontSize="8"
            fill="#7E694F"
            fontWeight="600"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {(min + max) / 2}
          </text>
          <text
            x={cx + r + 4}
            y={cy + 16}
            fontSize="9"
            fill="#7E694F"
            fontWeight="600"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {max}
          </text>
        </svg>

        {/* Center Readout */}
        <div className="text-center -mt-3">
          <div className="flex items-baseline justify-center gap-0.5">
            <span className="text-2xl font-bold font-tabular text-[#2C2922] tracking-tight">
              {clampedValue.toFixed(1)}
            </span>
            <span className="text-xs font-semibold text-[#4D6A75] font-tabular">
              {unit}
            </span>
          </div>

          <span
            className="inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border mt-0.5"
            style={{
              backgroundColor: `${activeColor}15`,
              color: activeColor,
              borderColor: `${activeColor}40`,
            }}
          >
            {level}
          </span>
        </div>
      </div>

      {subLabel && (
        <span className="text-[10px] text-[#4D6A75] mt-1 text-center font-medium max-w-44 leading-tight">
          {subLabel}
        </span>
      )}
    </div>
  );
};
