// Ikon SVG sederhana (garis, ikut warna teks). Tanpa library tambahan.
const base = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
}
const make = (children) => function Icon(props) {
  return <svg {...base} {...props}>{children}</svg>
}

export const IconDashboard = make(<><path d="M3 3h8v8H3z" /><path d="M13 3h8v5h-8z" /><path d="M13 11h8v10h-8z" /><path d="M3 14h8v7H3z" /></>)
export const IconKasir = make(<><path d="M3 4h2.2l2.4 11h10.2l2-8H6.3" /><circle cx="9.5" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>)
export const IconReceipt = make(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h6" /></>)
export const IconBox = make(<><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5" /><path d="M12 12v9" /></>)
export const IconPie = make(<><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.4A9 9 0 0 1 20.6 9H15z" /></>)
export const IconSliders = make(<><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>)
export const IconChevronLeft = make(<path d="M15 5l-7 7 7 7" />)
export const IconChevronRight = make(<path d="M9 5l7 7-7 7" />)
export const IconLogout = make(<><path d="M9 4H5v16h4" /><path d="M16 8l4 4-4 4" /><path d="M20 12H9" /></>)
export const IconUser = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.5 4-6 8-6s7 1.5 8 6" /></>)
