// Estructura de navegación compartida (Sidebar + Topbar)
export const NAV = {
  admin: [
    { area: 'Dirección', items: [
      { href: '/', label: 'Resumen ejecutivo', icon: 'home' },
      { href: '/direccion', label: 'Dashboard dirección', icon: 'chart' },
      { href: '/finanzas', label: 'Control financiero', icon: 'dollar' },
      { href: '/centro', label: 'Centro de inteligencia', icon: 'brain' }
    ]},
    { area: 'Gestión de pacientes', items: [
      { href: '/pacientes', label: 'Pacientes', icon: 'users' },
      { href: '/expediente', label: 'Expediente 360°', icon: 'folder' },
      { href: '/semaforo', label: 'Semáforo de riesgo', icon: 'gauge' },
      { href: '/paquetes', label: 'Paquetes y cobros', icon: 'box' },
      { href: '/constancia', label: 'Constancias', icon: 'doc' }
    ]},
    { area: 'Atención profesional', items: [
      { href: '/agenda', label: 'Agenda', icon: 'calendar' },
      { href: '/visitas', label: 'Visitas', icon: 'clipboard' },
      { href: '/registrar', label: 'Registrar visita', icon: 'edit' },
      { href: '/seguimiento', label: 'Seguimiento', icon: 'trend' },
      { href: '/mapa', label: 'Mapa en vivo', icon: 'map' }
    ]},
    { area: 'Familia', items: [
      { href: '/familiar', label: 'Portal familiar', icon: 'heart' },
      { href: '/encuestas', label: 'Encuestas', icon: 'star' }
    ]},
    { area: 'Talento humano', items: [
      { href: '/personal', label: 'Personal', icon: 'idcard' },
      { href: '/academia', label: 'Academia', icon: 'cap' },
      { href: '/evaluaciones', label: 'Evaluaciones', icon: 'check' },
      { href: '/planes', label: 'Planes de mejora', icon: 'trend' }
    ]},
    { area: 'Innovación y territorio', items: [
      { href: '/observatorio', label: 'Observatorio', icon: 'globe' }
    ]},
    { area: 'Comunicación', items: [
      { href: '/mensajeria', label: 'Mensajería', icon: 'chat' },
      { href: '/emergencias', label: 'Emergencias', icon: 'alert' },
      { href: '/chat-emergencia', label: 'Chat emergencia', icon: 'siren' }
    ]}
  ],
  staff: [
    { area: 'Mi trabajo', items: [
      { href: '/', label: 'Mi panel', icon: 'home' },
      { href: '/mis-pacientes', label: 'Mis pacientes', icon: 'users' },
      { href: '/mapa-pacientes', label: 'Mapa de pacientes', icon: 'map' },
      { href: '/agenda', label: 'Mi agenda', icon: 'calendar' },
      { href: '/visitas', label: 'Mis visitas', icon: 'clipboard' },
      { href: '/registrar', label: 'Registrar visita', icon: 'edit' },
      { href: '/seguimiento', label: 'Seguimiento', icon: 'trend' }
    ]},
    { area: 'Formación', items: [
      { href: '/academia', label: 'Academia', icon: 'cap' },
      { href: '/evaluaciones', label: 'Evaluaciones', icon: 'check' },
      { href: '/planes', label: 'Mis planes', icon: 'trend' }
    ]},
    { area: 'Comunicación', items: [
      { href: '/mensajeria', label: 'Mensajería', icon: 'chat' },
      { href: '/chat-emergencia', label: 'Chat emergencia', icon: 'siren' }
    ]}
  ],
  familiar: [
    { area: 'Mi familia', items: [
      { href: '/familiar', label: 'Portal familiar', icon: 'heart' },
      { href: '/pagos-depositos', label: 'Pagos y depósitos', icon: 'dollar' },
      { href: '/encuestas', label: 'Encuestas', icon: 'star' },
      { href: '/mensajeria', label: 'Mensajería', icon: 'chat' }
    ]}
  ],
  otro: [
    { area: 'General', items: [
      { href: '/', label: 'Inicio', icon: 'home' },
      { href: '/mensajeria', label: 'Mensajería', icon: 'chat' }
    ]}
  ]
};

export function navParaRol(rol) {
  if (rol === 'admin') return NAV.admin;
  if (rol === 'staff' || rol === 'cuidador') return NAV.staff;
  if (rol === 'familiar') return NAV.familiar;
  return NAV.otro;
}

export function rutaActiva(pathname, href) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
}

// Devuelve { area, item } de la ruta actual para breadcrumbs
export function moduloActual(pathname, nav) {
  for (const g of nav) {
    for (const i of g.items) {
      if (rutaActiva(pathname, i.href)) return { area: g.area, item: i };
    }
  }
  return null;
}
