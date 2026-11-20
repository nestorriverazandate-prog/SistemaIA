<script>
  let { name, size = 18 } = $props();
  const paths = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 1 5.5A3 3 0 0 0 9 21a3 3 0 0 0 3-2V6a3 3 0 0 0-3-2Z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-1 5.5A3 3 0 0 1 15 21a3 3 0 0 1-3-2V6a3 3 0 0 1 3-2Z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M17.5 14.5c2 .8 4 2.7 4 5.5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    gauge: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-5"/><circle cx="12" cy="15" r="1.5"/>',
    box: '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    doc: '<path d="M6 2.5h8L19 8v13.5H6Z"/><path d="M14 2.5V8h5"/><path d="M9 12h6M9 15.5h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5a3 3 0 0 1 6 0"/><path d="M9 11h6M9 15h4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="M14 6l4 4"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z"/><path d="M9 4v14M15 6v14"/>',
    heart: '<path d="M12 20s-7-4.6-9.3-9A5.2 5.2 0 0 1 12 6.5 5.2 5.2 0 0 1 21.3 11c-2.3 4.4-9.3 9-9.3 9Z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8Z"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16.5c.5-1.7 1.7-2.5 3-2.5s2.5.8 3 2.5"/><path d="M14 9.5h5M14 13h5"/>',
    cap: '<path d="m2.5 9 9.5-4.5L21.5 9 12 13.5Z"/><path d="M6.5 11.5V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.5"/><path d="M21.5 9v5"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z"/>',
    alert: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17.5v.5"/>',
    siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M4 18h16"/><path d="M12 3v2M5 6l1.5 1.5M19 6l-1.5 1.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    pin: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.07-.4.1-.8.1-1.2Z"/>',
    dollar: '<path d="M12 2v20M17 6.5c-.8-1.5-2.7-2.5-5-2.5-2.8 0-5 1.6-5 4 0 5.5 10 2.5 10 8 0 2.4-2.2 4-5 4-2.3 0-4.2-1-5-2.5"/>'
  };
  let d = $derived(paths[name] || paths.home);
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {@html d}
</svg>
