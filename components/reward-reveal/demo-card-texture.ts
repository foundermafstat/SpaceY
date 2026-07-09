export function createDemoCardTextureUrl() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="716" viewBox="0 0 512 716">
  <defs>
    <linearGradient id="body" x1="55" y1="20" x2="450" y2="690" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#13202b"/>
      <stop offset="0.42" stop-color="#172f54"/>
      <stop offset="1" stop-color="#05070e"/>
    </linearGradient>
    <radialGradient id="core" cx="50%" cy="42%" r="55%">
      <stop offset="0" stop-color="#b8fff8" stop-opacity="0.92"/>
      <stop offset="0.35" stop-color="#24f2db" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#0b0f17" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="cardClip">
      <path d="M84 18H428L494 84V632L428 698H84L18 632V84Z"/>
    </clipPath>
    <filter id="innerGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.08 0 0 0 0 1 0 0 0 0 0.9 0 0 0 0.65 0"/>
      <feBlend in="SourceGraphic" mode="screen"/>
    </filter>
  </defs>
  <g clip-path="url(#cardClip)">
    <rect width="512" height="716" fill="url(#body)"/>
    <rect width="512" height="716" fill="url(#core)"/>
    <path d="M0 96L512 28V78L0 146Z" fill="#7ffcff" opacity="0.22"/>
    <path d="M0 598L512 514V568L0 652Z" fill="#ff35d8" opacity="0.18"/>
    <path d="M72 140H440V576H72Z" fill="#05070d" opacity="0.42"/>
    <circle cx="256" cy="308" r="114" fill="#0cf4d7" opacity="0.2"/>
    <path d="M256 178L334 302L256 426L178 302Z" fill="#101928" stroke="#8ffdf4" stroke-width="12" opacity="0.92" filter="url(#innerGlow)"/>
    <path d="M256 222L306 302L256 382L206 302Z" fill="#7ffcff" opacity="0.72"/>
    <path d="M120 616H392" stroke="#8ffdf4" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
    <path d="M150 646H362" stroke="#ff4ee7" stroke-width="8" stroke-linecap="round" opacity="0.5"/>
    <path d="M18 84L84 18H428L494 84V632L428 698H84L18 632Z" fill="none" stroke="#d9fffb" stroke-width="10" opacity="0.7"/>
    <path d="M42 102L102 42H410L470 102V614L410 674H102L42 614Z" fill="none" stroke="#24f2db" stroke-width="4" opacity="0.72"/>
  </g>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
