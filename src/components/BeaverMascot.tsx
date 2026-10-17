interface BeaverMascotProps {
  className?: string
}

/**
 * FixFlix mascot: a beaver wearing a hard hat, holding a wrench.
 * Placeholder illustration — swap for a professional one before launch.
 */
export default function BeaverMascot({ className }: BeaverMascotProps) {
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="FixFlix Biber">
      {/* tail */}
      <g transform="rotate(35 150 155)">
        <ellipse cx="150" cy="155" rx="32" ry="17" fill="#5c3d26" />
        <path
          d="M126 148 h48 M126 155 h48 M126 162 h48 M138 141 v28 M152 141 v28 M166 141 v28"
          stroke="#4a2f1d"
          strokeWidth="2"
          fill="none"
        />
      </g>
      {/* body */}
      <ellipse cx="100" cy="128" rx="54" ry="46" fill="#8b5e3c" />
      <ellipse cx="100" cy="138" rx="34" ry="30" fill="#c89f7b" />
      {/* feet */}
      <ellipse cx="78" cy="170" rx="15" ry="8" fill="#6b4226" />
      <ellipse cx="122" cy="170" rx="15" ry="8" fill="#6b4226" />
      {/* left arm + wrench */}
      <g transform="rotate(15 55 120)">
        <rect x="14" y="112" width="44" height="9" rx="4.5" fill="#9ca3af" />
        <circle cx="16" cy="116" r="10" fill="#9ca3af" />
        <circle cx="10" cy="112" r="5" fill="#fdf7ee" />
      </g>
      <ellipse cx="55" cy="122" rx="12" ry="17" fill="#8b5e3c" transform="rotate(25 55 122)" />
      {/* right arm */}
      <ellipse cx="145" cy="122" rx="12" ry="17" fill="#8b5e3c" transform="rotate(-25 145 122)" />
      {/* head */}
      <circle cx="100" cy="75" r="42" fill="#8b5e3c" />
      {/* cheeks */}
      <circle cx="70" cy="85" r="7" fill="#e8a87c" opacity="0.6" />
      <circle cx="130" cy="85" r="7" fill="#e8a87c" opacity="0.6" />
      {/* muzzle */}
      <ellipse cx="100" cy="93" rx="24" ry="18" fill="#c89f7b" />
      <ellipse cx="100" cy="84" rx="9" ry="6" fill="#3e2a1b" />
      {/* teeth */}
      <rect x="91" y="96" width="8.5" height="13" rx="2" fill="#ffffff" stroke="#e5e0d8" />
      <rect x="100.5" y="96" width="8.5" height="13" rx="2" fill="#ffffff" stroke="#e5e0d8" />
      {/* eyes */}
      <circle cx="84" cy="66" r="5" fill="#2b1b10" />
      <circle cx="116" cy="66" r="5" fill="#2b1b10" />
      <circle cx="86" cy="64" r="1.6" fill="#ffffff" />
      <circle cx="118" cy="64" r="1.6" fill="#ffffff" />
      {/* hard hat */}
      <path d="M66 48 A 34 30 0 0 1 134 48 Z" fill="#f97316" />
      <rect x="94" y="24" width="12" height="24" rx="5" fill="#fdba74" />
      <rect x="56" y="46" width="88" height="9" rx="4.5" fill="#ea580c" />
    </svg>
  )
}
